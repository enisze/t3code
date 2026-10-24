/**
 * `t3 thread`: start, message, and read threads on the running server from a
 * shell. Commands call the server's HTTP API with a short-lived session minted
 * from this machine's server secrets, as `t3 project` does when a server runs.
 *
 * @module cli/thread
 */
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  type ClientOrchestrationCommand,
  CommandId,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  EnvironmentHttpApi,
  EnvironmentHttpCommonError,
  EnvironmentResourceNotFoundError,
  MessageId,
  ModelSelection,
  type OrchestrationProjectShell,
  type OrchestrationShellSnapshot,
  type OrchestrationThread,
  type OrchestrationThreadShell,
  ProviderInstanceId,
  ThreadId,
  TrimmedNonEmptyString,
  type TurnId,
} from "@t3tools/contracts";
import { HostProcessWorkingDirectory } from "@t3tools/shared/hostProcess";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Console from "effect/Console";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as References from "effect/References";
import * as Runtime from "effect/Runtime";
import * as Schema from "effect/Schema";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import { Argument, Command, Flag, GlobalFlag } from "effect/unstable/cli";
import { FetchHttpClient, HttpClientError } from "effect/unstable/http";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { expandHomePath } from "../os-jank.ts";
import { readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { type CliAuthLocationFlags, projectLocationFlags, resolveCliAuthConfig } from "./config.ts";

const POLL_INTERVAL = Duration.seconds(2);
const REQUEST_TIMEOUT = Duration.seconds(30);
const TITLE_MAX_CHARS = 80;
// Reading and starting turns is all the CLI does. The session is revoked when
// the command ends; the TTL only bounds one left behind by a killed process.
const SESSION_SCOPES = [AuthOrchestrationReadScope, AuthOrchestrationOperateScope];
const SESSION_TTL = Duration.days(1);

export class ThreadServerNotRunningError extends Schema.TaggedErrorClass<ThreadServerNotRunningError>()(
  "ThreadServerNotRunningError",
  { baseDir: Schema.String },
) {
  override readonly [Runtime.errorReported] = false;
  override get message(): string {
    return `No running T3 Code server uses ${this.baseDir}. Start T3 Code, then retry.`;
  }
}

export class ThreadServerUnreachableError extends Schema.TaggedErrorClass<ThreadServerUnreachableError>()(
  "ThreadServerUnreachableError",
  { origin: Schema.String, cause: Schema.Defect() },
) {
  override readonly [Runtime.errorReported] = false;
  override get message(): string {
    return `Could not reach the T3 Code server at ${this.origin}.`;
  }
}

export class ThreadServerRequestError extends Schema.TaggedErrorClass<ThreadServerRequestError>()(
  "ThreadServerRequestError",
  { detail: Schema.String, cause: Schema.Defect() },
) {
  override readonly [Runtime.errorReported] = false;
  override get message(): string {
    return this.detail;
  }
}

export class ThreadUsageError extends Schema.TaggedErrorClass<ThreadUsageError>()(
  "ThreadUsageError",
  { detail: Schema.String },
) {
  override readonly [Runtime.errorReported] = false;
  override get message(): string {
    return this.detail;
  }
}

export class ThreadProjectNotFoundError extends Schema.TaggedErrorClass<ThreadProjectNotFoundError>()(
  "ThreadProjectNotFoundError",
  { identifier: Schema.String },
) {
  override readonly [Runtime.errorReported] = false;
  override get message(): string {
    return `No T3 Code project matches '${this.identifier}'. Pass a project id or a path inside a project.`;
  }
}

export class ThreadNotFoundError extends Schema.TaggedErrorClass<ThreadNotFoundError>()(
  "ThreadNotFoundError",
  { threadId: ThreadId },
) {
  override readonly [Runtime.errorReported] = false;
  override get message(): string {
    return `No thread ${this.threadId} on this server.`;
  }
}

export class ThreadArchivedError extends Schema.TaggedErrorClass<ThreadArchivedError>()(
  "ThreadArchivedError",
  { threadId: ThreadId },
) {
  override readonly [Runtime.errorReported] = false;
  override get message(): string {
    return `Thread ${this.threadId} is archived. Unarchive it in T3 Code to message it.`;
  }
}

/** Exit code 2 lets a script tell "needs a human" apart from a failed turn. */
export class ThreadNeedsInputError extends Schema.TaggedErrorClass<ThreadNeedsInputError>()(
  "ThreadNeedsInputError",
  { threadId: ThreadId, sent: Schema.Boolean },
) {
  override readonly [Runtime.errorReported] = false;
  override readonly [Runtime.errorExitCode] = 2;
  override get message(): string {
    return this.sent
      ? `Thread ${this.threadId} is waiting for an answer. Open it in T3 Code to respond.`
      : `Thread ${this.threadId} is waiting for an answer, so the message was not sent. Open it in T3 Code to respond.`;
  }
}

export class ThreadTurnEndedError extends Schema.TaggedErrorClass<ThreadTurnEndedError>()(
  "ThreadTurnEndedError",
  { threadId: ThreadId, status: Schema.String, error: Schema.optional(Schema.String) },
) {
  override readonly [Runtime.errorReported] = false;
  override get message(): string {
    const reason = this.error === undefined ? "." : `: ${this.error}`;
    return `Thread ${this.threadId} stopped with status ${this.status}${reason}`;
  }
}

const ThreadCliError = Schema.Union([
  ThreadServerNotRunningError,
  ThreadServerUnreachableError,
  ThreadServerRequestError,
  ThreadUsageError,
  ThreadProjectNotFoundError,
  ThreadNotFoundError,
  ThreadArchivedError,
  ThreadNeedsInputError,
  ThreadTurnEndedError,
]);
const isThreadCliError = Schema.is(ThreadCliError);

/**
 * These errors are expected outcomes for a script, so they print as one line
 * on stderr instead of the runtime's logged stack trace.
 */
const reportThreadErrors = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.tapError((error) =>
      isThreadCliError(error) ? Console.error(error.message) : Effect.void,
    ),
  );

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const printJson = (value: unknown) => Console.log(encodeJson(value));

type ThreadServerError = ThreadServerUnreachableError | ThreadServerRequestError;
type ThreadCliCommand = Extract<
  ClientOrchestrationCommand,
  { readonly type: "thread.create" | "thread.turn.start" | "thread.delete" }
>;

/** The running server's orchestration API, as the thread commands use it. */
export interface ThreadServer {
  /** Active projects and threads, without message bodies. */
  readonly shell: Effect.Effect<OrchestrationShellSnapshot, ThreadServerError>;
  /** One thread with the messages of its latest `turnLimit` user turns. */
  readonly thread: (
    threadId: ThreadId,
    turnLimit: number,
  ) => Effect.Effect<OrchestrationThread, ThreadServerError | ThreadNotFoundError>;
  readonly dispatch: (command: ThreadCliCommand) => Effect.Effect<void, ThreadServerError>;
}

const isEnvironmentHttpCommonError = Schema.is(EnvironmentHttpCommonError);
const isResourceNotFound = Schema.is(EnvironmentResourceNotFoundError);

const toServerError =
  (origin: string) =>
  (cause: unknown): ThreadServerError => {
    if (isEnvironmentHttpCommonError(cause)) {
      return new ThreadServerRequestError({ detail: cause.message, cause });
    }
    if (HttpClientError.isHttpClientError(cause) && cause.response !== undefined) {
      return new ThreadServerRequestError({
        detail: `The T3 Code server answered with status ${cause.response.status}.`,
        cause,
      });
    }
    return new ThreadServerUnreachableError({ origin, cause });
  };

const makeEnvironmentClient = (origin: string) =>
  HttpApiClient.make(EnvironmentHttpApi, { baseUrl: origin });

const makeThreadServer = (
  client: Effect.Success<ReturnType<typeof makeEnvironmentClient>>,
  origin: string,
  token: string,
): ThreadServer => {
  const headers = { authorization: `Bearer ${token}` };
  const request = <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(Effect.timeout(REQUEST_TIMEOUT), Effect.mapError(toServerError(origin)));
  return {
    shell: request(client.orchestration.shellSnapshot({ headers })),
    thread: (threadId, turnLimit) =>
      client.orchestration
        .threadSnapshot({ headers, params: { threadId }, payload: { turnLimit } })
        .pipe(
          Effect.timeout(REQUEST_TIMEOUT),
          Effect.map((snapshot) => snapshot.thread),
          Effect.mapError((cause) =>
            isResourceNotFound(cause)
              ? new ThreadNotFoundError({ threadId })
              : toServerError(origin)(cause),
          ),
        ),
    dispatch: (command) =>
      request(
        client.orchestration.dispatch({ headers, payload: command } as Parameters<
          typeof client.orchestration.dispatch
        >[0]),
      ).pipe(Effect.asVoid),
  };
};

/**
 * Signs in to the running server as a short-lived client of this machine's
 * owner and revokes that session when the command ends.
 */
const withThreadServer = Effect.fn("cli.thread.withServer")(function* <A, E, R>(
  flags: CliAuthLocationFlags,
  run: (server: ThreadServer, context: { readonly settingsPath: string }) => Effect.Effect<A, E, R>,
) {
  const logLevel = yield* GlobalFlag.LogLevel;
  const config = yield* resolveCliAuthConfig(flags, logLevel);
  return yield* Effect.gen(function* () {
    const runtimeState = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);
    if (Option.isNone(runtimeState)) {
      return yield* new ThreadServerNotRunningError({ baseDir: config.baseDir });
    }
    const origin = runtimeState.value.origin;
    const environmentAuth = yield* EnvironmentAuth.EnvironmentAuth;
    const issued = yield* Effect.acquireRelease(
      environmentAuth.issueSession({
        scopes: SESSION_SCOPES,
        label: "t3 thread cli",
        ttl: SESSION_TTL,
      }),
      (session) =>
        environmentAuth.revokeSession(session.sessionId).pipe(Effect.ignore({ log: true })),
    );
    const client = yield* makeEnvironmentClient(origin);
    return yield* run(makeThreadServer(client, origin, issued.token), {
      settingsPath: config.settingsPath,
    });
  }).pipe(
    Effect.scoped,
    Effect.provide(
      EnvironmentAuth.runtimeLayer.pipe(
        Layer.provideMerge(FetchHttpClient.layer),
        Layer.provide(ServerConfig.layer(config)),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, config.logLevel)),
      ),
    ),
  );
});

const uuid = Crypto.Crypto.pipe(Effect.flatMap((crypto) => crypto.randomUUIDv4));
const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const decodeThreadIdValue = Schema.decodeUnknownEffect(ThreadId);
const decodeThreadId = (value: string) =>
  decodeThreadIdValue(value.trim()).pipe(
    Effect.mapError(() => new ThreadUsageError({ detail: `'${value}' is not a thread id.` })),
  );
const decodeTrimmed = Schema.decodeUnknownEffect(TrimmedNonEmptyString);
const decodeProviderInstanceId = Schema.decodeUnknownEffect(ProviderInstanceId);

const readMessageArgument = Effect.fn("cli.thread.readMessage")(function* (argument: string) {
  const text =
    argument === "-"
      ? yield* Stdio.Stdio.pipe(
          Effect.flatMap((stdio) => stdio.stdin.pipe(Stream.decodeText(), Stream.mkString)),
        )
      : argument;
  if (text.trim().length === 0) {
    return yield* new ThreadUsageError({ detail: "The message is empty." });
  }
  return text;
});

/** The message's first non-empty line, shortened to a sidebar-sized title. */
export const titleFromMessage = (message: string) => {
  const firstLine =
    message
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  return firstLine.length > TITLE_MAX_CHARS
    ? `${firstLine.slice(0, TITLE_MAX_CHARS - 1).trimEnd()}…`
    : firstLine;
};

/** A project id, or a path inside a project's folder (the deepest project wins). */
export const resolveProject = Effect.fn("cli.thread.resolveProject")(function* (
  projects: ReadonlyArray<OrchestrationProjectShell>,
  identifier: string,
  cwd: string,
) {
  const trimmed = identifier.trim();
  const byId = projects.find((project) => project.id === trimmed);
  if (byId !== undefined) return byId;

  const path = yield* Path.Path;
  const fileSystem = yield* FileSystem.FileSystem;
  // Stored roots keep the path the project was added with, which may pass
  // through a symlink (macOS /tmp), so both sides compare as real paths.
  const realPath = (value: string) =>
    fileSystem.realPath(value).pipe(Effect.orElseSucceed(() => value));
  const target = yield* realPath(path.resolve(cwd, yield* expandHomePath(trimmed)));
  const roots = yield* Effect.forEach(projects, (project) =>
    Effect.map(realPath(project.workspaceRoot), (root) => ({ project, root })),
  );
  const containing = roots
    .filter(({ root }) => {
      const relative = path.relative(root, target);
      return (
        relative === "" ||
        (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
      );
    })
    .toSorted((left, right) => right.root.length - left.root.length)[0];
  if (containing === undefined) {
    return yield* new ThreadProjectNotFoundError({ identifier });
  }
  return containing.project;
});

const SettingsDefaultModel = Schema.Struct({
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
});
const decodeSettingsDefaultModel = Schema.decodeUnknownOption(
  fromLenientJson(SettingsDefaultModel),
);

/** The server's default model for new threads; null when unset or unreadable. */
const readServerDefaultModel = Effect.fn("cli.thread.readServerDefaultModel")(function* (
  settingsPath: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const raw = yield* fileSystem.readFileString(settingsPath).pipe(Effect.orElseSucceed(() => ""));
  return Option.match(decodeSettingsDefaultModel(raw), {
    onNone: () => null,
    onSome: (settings) => settings.defaultModelSelection ?? null,
  });
});

/**
 * The model a new thread starts with, in the order the server uses for the
 * thread it creates on first launch: the flags, the project's default, the
 * server's default, then the built-in default.
 */
export const resolveModelSelection = (input: {
  readonly flags: ModelSelection | undefined;
  readonly projectDefault: ModelSelection | null;
  readonly serverDefault: ModelSelection | null;
}): ModelSelection =>
  input.flags ??
  input.projectDefault ??
  input.serverDefault ?? { instanceId: ProviderInstanceId.make("codex"), model: DEFAULT_MODEL };

const parseModelFlags = Effect.fn("cli.thread.parseModelFlags")(function* (flags: {
  readonly provider: Option.Option<string>;
  readonly model: Option.Option<string>;
}) {
  if (Option.isSome(flags.provider) !== Option.isSome(flags.model)) {
    return yield* new ThreadUsageError({ detail: "--provider and --model go together." });
  }
  if (Option.isNone(flags.provider) || Option.isNone(flags.model)) return undefined;
  const provider = flags.provider.value;
  const instanceId = yield* decodeProviderInstanceId(provider.trim()).pipe(
    Effect.mapError(
      () => new ThreadUsageError({ detail: `'${provider}' is not a provider instance id.` }),
    ),
  );
  const model = yield* decodeTrimmed(flags.model.value).pipe(
    Effect.mapError(() => new ThreadUsageError({ detail: "The model is empty." })),
  );
  return { instanceId, model } satisfies ModelSelection;
});

type ThreadState = Pick<OrchestrationThreadShell, "session" | "latestTurn"> & {
  readonly hasPendingApprovals?: boolean;
  readonly hasPendingUserInput?: boolean;
};

const isBusy = (thread: ThreadState) =>
  thread.session?.status === "starting" ||
  thread.session?.status === "running" ||
  thread.latestTurn?.state === "running";

/** An open approval or question blocks the running turn until someone answers it. */
const isWaitingForAnswer = (thread: ThreadState) =>
  thread.hasPendingApprovals === true || thread.hasPendingUserInput === true;

export type ThreadCliStatus =
  | "idle"
  | "running"
  | "waiting"
  | "completed"
  | "interrupted"
  | "error";

export const threadStatus = (thread: ThreadState): ThreadCliStatus => {
  if (isBusy(thread)) return isWaitingForAnswer(thread) ? "waiting" : "running";
  if (thread.latestTurn !== null) return thread.latestTurn.state;
  return thread.session?.status === "error" ? "error" : "idle";
};

/** The JSON shape `list` prints per thread and `show` prints as `thread`. */
const threadSummary = (
  thread: OrchestrationThreadShell | OrchestrationThread,
  status: ThreadCliStatus,
) => ({
  threadId: thread.id,
  projectId: thread.projectId,
  title: thread.title,
  status,
  provider: thread.modelSelection.instanceId,
  model: thread.modelSelection.model,
  branch: thread.branch,
  worktreePath: thread.worktreePath,
  createdAt: thread.createdAt,
  updatedAt: thread.updatedAt,
});

/** The thread among the active ones; an archived one is named as such. */
const findActiveThread = Effect.fn("cli.thread.findActiveThread")(function* (
  server: ThreadServer,
  threadId: ThreadId,
) {
  const shell = yield* server.shell;
  const thread = shell.threads.find((candidate) => candidate.id === threadId);
  if (thread !== undefined) return thread;
  const stored = yield* server.thread(threadId, 1);
  return yield* stored.archivedAt !== null
    ? new ThreadArchivedError({ threadId })
    : new ThreadNotFoundError({ threadId });
});

/** Waits out a busy thread's current turn, so a message sent next starts its own turn. */
export const waitForIdle = Effect.fn("cli.thread.waitForIdle")(function* (
  server: ThreadServer,
  threadId: ThreadId,
  pollInterval: Duration.Duration = POLL_INTERVAL,
) {
  while (true) {
    const thread = yield* findActiveThread(server, threadId);
    if (!isBusy(thread)) return thread;
    if (isWaitingForAnswer(thread)) {
      return yield* new ThreadNeedsInputError({ threadId, sent: false });
    }
    yield* Effect.sleep(pollInterval);
  }
});

export type TurnOutcome =
  | {
      readonly type: "ended";
      readonly turnId: TurnId | null;
      readonly status: "completed" | "interrupted" | "error" | "stopped";
      readonly error: string | null;
    }
  | { readonly type: "needs_input" };

/**
 * Waits for the turn that answers a message sent to an idle thread at
 * `sentAt`. That turn is requested at the message's own time, or, if another
 * client started a turn first and the message joined it, finishes after it.
 * A start that fails, or a provider command handled instead of a turn (such
 * as signing out), stamps the session with the message's time instead.
 */
export const waitForTurn = Effect.fn("cli.thread.waitForTurn")(function* (
  server: ThreadServer,
  input: { readonly threadId: ThreadId; readonly sentAt: string },
  pollInterval: Duration.Duration = POLL_INTERVAL,
) {
  const sentAt = Date.parse(input.sentAt);
  while (true) {
    const thread = yield* findActiveThread(server, input.threadId);
    if (isBusy(thread)) {
      if (isWaitingForAnswer(thread)) return { type: "needs_input" } satisfies TurnOutcome;
    } else {
      const turn = thread.latestTurn;
      if (
        turn !== null &&
        turn.state !== "running" &&
        (Date.parse(turn.requestedAt) >= sentAt ||
          (turn.completedAt !== null && Date.parse(turn.completedAt) >= sentAt))
      ) {
        return {
          type: "ended",
          turnId: turn.turnId,
          status: turn.state,
          error: turn.state === "error" ? (thread.session?.lastError ?? null) : null,
        } satisfies TurnOutcome;
      }
      const session = thread.session;
      if (session !== null && Date.parse(session.updatedAt) >= sentAt) {
        if (session.lastError !== null) {
          return {
            type: "ended",
            turnId: null,
            status: "error",
            error: session.lastError,
          } satisfies TurnOutcome;
        }
        if (session.status === "stopped" && Date.parse(session.updatedAt) === sentAt) {
          return {
            type: "ended",
            turnId: null,
            status: "stopped",
            error: null,
          } satisfies TurnOutcome;
        }
      }
    }
    yield* Effect.sleep(pollInterval);
  }
});

const finalReply = (thread: OrchestrationThread, turnId: TurnId | null) => {
  if (turnId === null) return null;
  const finalId =
    thread.latestTurn?.turnId === turnId ? thread.latestTurn.assistantMessageId : null;
  const reply =
    (finalId === null ? undefined : thread.messages.find((message) => message.id === finalId)) ??
    thread.messages.findLast(
      (message) => message.role === "assistant" && message.turnId === turnId,
    );
  return reply === undefined ? null : reply.text;
};

const errorActivityText = (thread: OrchestrationThread, turnId: TurnId | null) => {
  const activity = thread.activities.findLast(
    (entry) => entry.tone === "error" && (turnId === null || entry.turnId === turnId),
  );
  if (activity === undefined) return null;
  const payload = activity.payload;
  return typeof payload === "object" &&
    payload !== null &&
    "detail" in payload &&
    typeof payload.detail === "string"
    ? payload.detail
    : activity.summary;
};

/**
 * With --json the result always reaches stdout, so a script keeps the thread
 * id even when the turn fails.
 */
const finishTurn = Effect.fn("cli.thread.finishTurn")(function* (
  server: ThreadServer,
  input: { readonly threadId: ThreadId; readonly sentAt: string; readonly json: boolean },
) {
  const outcome = yield* waitForTurn(server, input);
  const ended = outcome.type === "ended" ? outcome : null;
  const status = ended?.status ?? "waiting";
  const turnId = ended?.turnId ?? null;
  const detail =
    status === "completed" || (status === "error" && ended?.error === null)
      ? yield* server.thread(input.threadId, 1)
      : null;
  const reply = status === "completed" && detail !== null ? finalReply(detail, turnId) : null;
  const error =
    ended?.error ??
    (status === "error" && detail !== null ? errorActivityText(detail, turnId) : null);
  if (input.json) {
    yield* printJson({ threadId: input.threadId, turnId, status, reply, error });
  } else if (reply !== null) {
    yield* Console.log(reply);
  }
  if (ended === null) {
    return yield* new ThreadNeedsInputError({ threadId: input.threadId, sent: true });
  }
  if (status !== "completed" && status !== "stopped") {
    return yield* new ThreadTurnEndedError({
      threadId: input.threadId,
      status,
      ...(error === null ? {} : { error }),
    });
  }
});

const jsonFlag = Flag.boolean("json").pipe(
  Flag.withDescription("Print JSON instead of text."),
  Flag.withDefault(false),
);
const waitFlag = Flag.boolean("wait").pipe(
  Flag.withDescription(
    "Wait for the agent to finish and print its reply. Exits 1 if the turn fails or stops and 2 if it waits for an answer.",
  ),
  Flag.withDefault(false),
);
const messageArgument = Argument.string("message").pipe(
  Argument.withDescription("Message for the agent, or - to read it from stdin."),
);
const threadArgument = Argument.string("thread").pipe(Argument.withDescription("Thread id."));

const threadListCommand = Command.make("list", {
  ...projectLocationFlags,
  project: Flag.string("project").pipe(
    Flag.withDescription("Project id or a path inside the project. Defaults to this directory."),
    Flag.withDefault("."),
  ),
  json: jsonFlag,
}).pipe(
  Command.withDescription("List a project's active threads, newest first."),
  Command.withHandler((flags) =>
    withThreadServer(
      flags,
      Effect.fn("cli.thread.list")(function* (server) {
        const shell = yield* server.shell;
        const project = yield* resolveProject(
          shell.projects,
          flags.project,
          yield* HostProcessWorkingDirectory,
        );
        const threads = shell.threads
          .filter((thread) => thread.projectId === project.id)
          .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
        if (flags.json) {
          return yield* printJson(
            threads.map((thread) => threadSummary(thread, threadStatus(thread))),
          );
        }
        for (const thread of threads) {
          yield* Console.log(`${thread.id}  ${threadStatus(thread).padEnd(11)}  ${thread.title}`);
        }
      }),
    ).pipe(reportThreadErrors),
  ),
);

const threadStartCommand = Command.make("start", {
  ...projectLocationFlags,
  project: Argument.string("project").pipe(
    Argument.withDescription("Project id or a path inside the project, such as ."),
  ),
  message: messageArgument,
  title: Flag.string("title").pipe(
    Flag.withDescription("Thread title. Defaults to the message's first line."),
    Flag.optional,
  ),
  provider: Flag.string("provider").pipe(
    Flag.withDescription("Provider instance id, such as codex or claude. Pass with --model."),
    Flag.optional,
  ),
  model: Flag.string("model").pipe(
    Flag.withDescription("Model slug. Defaults to the project's default model, then the server's."),
    Flag.optional,
  ),
  wait: waitFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Start a thread in a project's folder and print its id."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const message = yield* readMessageArgument(flags.message);
      const modelFlags = yield* parseModelFlags(flags);
      const explicitTitle = Option.isSome(flags.title)
        ? yield* decodeTrimmed(flags.title.value).pipe(
            Effect.mapError(() => new ThreadUsageError({ detail: "The title is empty." })),
          )
        : undefined;
      const title = explicitTitle ?? titleFromMessage(message);
      yield* withThreadServer(
        flags,
        Effect.fn("cli.thread.start")(function* (server, context) {
          const shell = yield* server.shell;
          const project = yield* resolveProject(
            shell.projects,
            flags.project,
            yield* HostProcessWorkingDirectory,
          );
          const modelSelection = resolveModelSelection({
            flags: modelFlags,
            projectDefault: project.defaultModelSelection,
            serverDefault:
              modelFlags === undefined && project.defaultModelSelection === null
                ? yield* readServerDefaultModel(context.settingsPath)
                : null,
          });
          const threadId = ThreadId.make(yield* uuid);
          yield* server.dispatch({
            type: "thread.create",
            commandId: CommandId.make(yield* uuid),
            threadId,
            projectId: project.id,
            title,
            modelSelection,
            runtimeMode: DEFAULT_RUNTIME_MODE,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            branch: null,
            worktreePath: null,
            createdAt: yield* nowIso,
          });
          const sentAt = yield* nowIso;
          yield* server
            .dispatch({
              type: "thread.turn.start",
              commandId: CommandId.make(yield* uuid),
              threadId,
              message: {
                messageId: MessageId.make(yield* uuid),
                role: "user",
                text: message,
                attachments: [],
              },
              modelSelection,
              // A title taken from the message may be replaced by a generated one, as in the app.
              ...(explicitTitle === undefined ? { titleSeed: title } : {}),
              runtimeMode: DEFAULT_RUNTIME_MODE,
              interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
              createdAt: sentAt,
            })
            .pipe(
              // The server refused the message, so remove the empty thread. A
              // lost response may still have started it, so that one stays.
              Effect.tapError((error) =>
                error._tag === "ThreadServerRequestError"
                  ? uuid.pipe(
                      Effect.flatMap((commandId) =>
                        server.dispatch({
                          type: "thread.delete",
                          commandId: CommandId.make(commandId),
                          threadId,
                        }),
                      ),
                      Effect.ignore,
                    )
                  : Effect.void,
              ),
            );
          if (flags.wait) {
            if (!flags.json) yield* Console.error(`Thread ${threadId}`);
            return yield* finishTurn(server, { threadId, sentAt, json: flags.json });
          }
          yield* flags.json
            ? printJson({ threadId, projectId: project.id })
            : Console.log(threadId);
        }),
      );
    }).pipe(reportThreadErrors),
  ),
);

const threadSendCommand = Command.make("send", {
  ...projectLocationFlags,
  thread: threadArgument,
  message: messageArgument,
  wait: waitFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription(
    "Send a message to a thread. A busy thread gets it as its next turn; nothing is interrupted.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const threadId = yield* decodeThreadId(flags.thread);
      const message = yield* readMessageArgument(flags.message);
      yield* withThreadServer(
        flags,
        Effect.fn("cli.thread.send")(function* (server) {
          let thread = yield* findActiveThread(server, threadId);
          // Sending into a running turn would steer it, so wait for its end instead.
          if (isBusy(thread)) {
            if (isWaitingForAnswer(thread)) {
              return yield* new ThreadNeedsInputError({ threadId, sent: false });
            }
            if (!flags.json) yield* Console.error("Waiting for the current turn to finish…");
            thread = yield* waitForIdle(server, threadId);
          }
          const messageId = MessageId.make(yield* uuid);
          const sentAt = yield* nowIso;
          yield* server.dispatch({
            type: "thread.turn.start",
            commandId: CommandId.make(yield* uuid),
            threadId,
            message: { messageId, role: "user", text: message, attachments: [] },
            runtimeMode: thread.runtimeMode,
            interactionMode: thread.interactionMode,
            createdAt: sentAt,
          });
          if (flags.wait) {
            return yield* finishTurn(server, { threadId, sentAt, json: flags.json });
          }
          yield* flags.json ? printJson({ threadId, messageId }) : Console.log("Sent.");
        }),
      );
    }).pipe(reportThreadErrors),
  ),
);

const threadShowCommand = Command.make("show", {
  ...projectLocationFlags,
  thread: threadArgument,
  messages: Flag.integer("messages").pipe(
    Flag.withDescription("How many of the latest messages to print."),
    Flag.withDefault(10),
  ),
  json: jsonFlag,
}).pipe(
  Command.withDescription("Show a thread's state and its latest messages."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const threadId = yield* decodeThreadId(flags.thread);
      if (flags.messages < 1) {
        return yield* new ThreadUsageError({ detail: "--messages must be at least 1." });
      }
      yield* withThreadServer(
        flags,
        Effect.fn("cli.thread.show")(function* (server) {
          // The latest N user turns hold at least the latest N messages.
          const [thread, shell] = yield* Effect.all(
            [server.thread(threadId, flags.messages), server.shell],
            { concurrency: 2 },
          );
          const status = threadStatus(
            shell.threads.find((candidate) => candidate.id === threadId) ?? thread,
          );
          const messages = thread.messages
            .filter((message) => message.role !== "system" && message.role !== "reasoning")
            .slice(-flags.messages)
            .map((message) => ({
              messageId: message.id,
              role: message.role,
              turnId: message.turnId,
              createdAt: message.createdAt,
              text: message.text,
            }));
          if (flags.json) {
            return yield* printJson({ thread: threadSummary(thread, status), messages });
          }
          yield* Console.log(thread.title);
          yield* Console.log(
            [
              thread.id,
              thread.archivedAt === null ? status : `${status} (archived)`,
              `${thread.modelSelection.instanceId}/${thread.modelSelection.model}`,
            ].join("  "),
          );
          if (thread.worktreePath !== null) {
            yield* Console.log(`${thread.branch ?? "(no branch)"}  ${thread.worktreePath}`);
          }
          if (status === "waiting") yield* Console.log("Waiting for an answer in T3 Code.");
          for (const entry of messages) {
            yield* Console.log(`\n[${entry.role}]\n${entry.text}`);
          }
        }),
      );
    }).pipe(reportThreadErrors),
  ),
);

export const threadCommand = Command.make("thread").pipe(
  Command.withDescription("Start, message, and read threads on the running server."),
  Command.withSubcommands([
    threadListCommand,
    threadStartCommand,
    threadSendCommand,
    threadShowCommand,
  ]),
);
