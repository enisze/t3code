/**
 * ThreadFind - find in one thread's messages and plans.
 *
 * Counts matches in the text the chat timeline shows for each entry (see
 * `@t3tools/shared/threadFindText`), across the whole thread, so a client finds
 * text in turns it has not loaded and its highlights agree with the counts.
 *
 * @module ThreadFind
 */
import {
  type OrchestrationSearchThreadInput,
  type OrchestrationSearchThreadResult,
  type OrchestrationThreadFindEntry,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import {
  searchableAssistantMessageSegments,
  searchablePlanSegments,
  searchableUserMessageSegments,
} from "@t3tools/shared/threadFindText";
import { countThreadSearchOccurrences } from "@t3tools/shared/threadSearch";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  toPersistenceDecodeError,
  toPersistenceSqlError,
  type ProjectionRepositoryError,
} from "../persistence/Errors.ts";

export interface ThreadFindDocument {
  readonly entryId: string;
  readonly turnId: TurnId | null;
  readonly count: number;
}

/** How many entries around the selection a result carries for stepping locally. */
const NAVIGATION_WINDOW = 17;

/**
 * Selects the match `offset` steps from `start`, wrapping around. Without a
 * start, or when its entry is gone, counting starts at the first match.
 */
export function selectThreadFindMatch(
  documents: ReadonlyArray<ThreadFindDocument>,
  input: Pick<OrchestrationSearchThreadInput, "start" | "offset">,
): OrchestrationSearchThreadResult {
  const totalMatches = documents.reduce((sum, document) => sum + document.count, 0);
  let startIndex = 0;
  if (input.start) {
    const startDocument = documents.findIndex(
      (document) => document.entryId === input.start?.entryId,
    );
    if (startDocument >= 0) {
      startIndex =
        documents.slice(0, startDocument).reduce((sum, document) => sum + document.count, 0) +
        Math.min(input.start.occurrence, documents[startDocument]!.count);
      if (startIndex >= totalMatches) startIndex = 0;
    }
  }
  const activeIndex =
    totalMatches > 0
      ? (((startIndex + (input.offset ?? 0)) % totalMatches) + totalMatches) % totalMatches
      : 0;

  const entries: OrchestrationThreadFindEntry[] = [];
  let matchStart = 0;
  for (const { entryId, turnId, count } of documents) {
    if (count > 0) entries.push({ entryId, turnId, startIndex: matchStart, count });
    matchStart += count;
  }
  const selected = entries.findIndex(
    (entry) => activeIndex >= entry.startIndex && activeIndex < entry.startIndex + entry.count,
  );
  const selectedEntry = entries[selected];
  const navigation =
    entries.length <= NAVIGATION_WINDOW
      ? entries
      : Array.from(
          { length: NAVIGATION_WINDOW },
          (_, index) =>
            entries[
              (selected + index - Math.floor(NAVIGATION_WINDOW / 2) + entries.length) %
                entries.length
            ]!,
        );
  return {
    totalMatches,
    activeIndex,
    match: selectedEntry
      ? {
          entryId: selectedEntry.entryId,
          turnId: selectedEntry.turnId,
          occurrence: activeIndex - selectedEntry.startIndex,
        }
      : null,
    navigation,
  };
}

const ThreadFindMessageRow = Schema.Struct({
  entryId: Schema.String,
  turnId: Schema.NullOr(TurnId),
  role: Schema.Literals(["user", "assistant"]),
  text: Schema.String,
  isStreaming: Schema.Number,
  createdAt: Schema.String,
});
const ThreadFindPlanRow = Schema.Struct({
  entryId: Schema.String,
  turnId: Schema.NullOr(TurnId),
  planMarkdown: Schema.String,
  createdAt: Schema.String,
});
const ThreadFindWorkspaceRow = Schema.Struct({
  worktreePath: Schema.NullOr(Schema.String),
  workspaceRoot: Schema.NullOr(Schema.String),
});
const ThreadLookup = Schema.Struct({ threadId: ThreadId });

type SearchableEntry =
  | (typeof ThreadFindMessageRow.Type & { readonly kind: "message" })
  | (typeof ThreadFindPlanRow.Type & { readonly kind: "plan" });

/** Entries in timeline order: by creation time, messages before plans on a tie. */
function timelineOrder(
  messages: ReadonlyArray<typeof ThreadFindMessageRow.Type>,
  plans: ReadonlyArray<typeof ThreadFindPlanRow.Type>,
): SearchableEntry[] {
  return [
    ...messages.map((row) => ({ ...row, kind: "message" as const })),
    ...plans.map((row) => ({ ...row, kind: "plan" as const })),
  ].toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
}

/** Rendering is the costly part, so repeated keystrokes reuse it per entry text. */
const MAX_CACHED_ENTRIES = 10_000;
const MAX_CACHED_CONTEXTS = 4;
/** Parses between yields, so a first search of a long thread does not hold the event loop. */
const PARSES_PER_YIELD = 25;

export class ThreadFind extends Context.Service<
  ThreadFind,
  {
    readonly search: (
      input: OrchestrationSearchThreadInput,
    ) => Effect.Effect<OrchestrationSearchThreadResult, ProjectionRepositoryError>;
  }
>()("t3/orchestration/ThreadFind") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const listMessages = SqlSchema.findAll({
    Request: ThreadLookup,
    Result: ThreadFindMessageRow,
    execute: ({ threadId }) => sql`
      SELECT
        message_id AS "entryId",
        turn_id AS "turnId",
        role,
        text,
        is_streaming AS "isStreaming",
        created_at AS "createdAt"
      FROM projection_thread_messages
      WHERE thread_id = ${threadId} AND role IN ('user', 'assistant')
      ORDER BY created_at ASC, message_id ASC
    `,
  });
  const listPlans = SqlSchema.findAll({
    Request: ThreadLookup,
    Result: ThreadFindPlanRow,
    execute: ({ threadId }) => sql`
      SELECT
        plan_id AS "entryId",
        turn_id AS "turnId",
        plan_markdown AS "planMarkdown",
        created_at AS "createdAt"
      FROM projection_thread_proposed_plans
      WHERE thread_id = ${threadId}
      ORDER BY created_at ASC, plan_id ASC
    `,
  });
  // The timeline resolves relative file links against the thread's worktree or project.
  const getWorkspace = SqlSchema.findOneOption({
    Request: ThreadLookup,
    Result: ThreadFindWorkspaceRow,
    execute: ({ threadId }) => sql`
      SELECT
        threads.worktree_path AS "worktreePath",
        projects.workspace_root AS "workspaceRoot"
      FROM projection_threads AS threads
      LEFT JOIN projection_projects AS projects ON projects.project_id = threads.project_id
      WHERE threads.thread_id = ${threadId}
    `,
  });

  const segmentCaches = new Map<string, Map<string, ReadonlyArray<string>>>();
  const segmentCacheFor = (contextKey: string) => {
    let cache = segmentCaches.get(contextKey);
    if (cache) {
      segmentCaches.delete(contextKey);
    } else {
      cache = new Map();
      if (segmentCaches.size >= MAX_CACHED_CONTEXTS) {
        segmentCaches.delete(segmentCaches.keys().next().value!);
      }
    }
    segmentCaches.set(contextKey, cache);
    return cache;
  };

  const search: ThreadFind["Service"]["search"] = Effect.fn("ThreadFind.search")(function* (input) {
    const lookup = { threadId: input.threadId };
    const [messages, plans, workspace] = yield* Effect.all([
      listMessages(lookup),
      listPlans(lookup),
      getWorkspace(lookup),
    ]).pipe(
      Effect.mapError((cause) =>
        Schema.isSchemaError(cause)
          ? toPersistenceDecodeError("ThreadFind.search:decodeRows")(cause)
          : toPersistenceSqlError("ThreadFind.search:query")(cause),
      ),
    );
    const cwd = Option.match(workspace, {
      onNone: () => undefined,
      onSome: (row) => row.worktreePath ?? row.workspaceRoot ?? undefined,
    });
    const skills = input.skills ?? [];
    const math = input.math === true;
    const cache = segmentCacheFor(
      [
        cwd ?? "",
        math ? "math" : "",
        ...skills.map(({ name, displayName }) => `${name}\u0001${displayName ?? ""}`),
      ].join("\u0000"),
    );

    const documents: ThreadFindDocument[] = [];
    let parses = 0;
    for (const entry of timelineOrder(messages, plans)) {
      const streaming = entry.kind === "message" && entry.isStreaming !== 0;
      const key =
        entry.kind === "plan"
          ? `plan\0${entry.planMarkdown}`
          : `${entry.role}\0${streaming ? 1 : 0}\0${entry.text}`;
      let segments = cache.get(key);
      if (segments) {
        // Refresh its place so the oldest unused entry is the one evicted.
        cache.delete(key);
      } else {
        segments =
          entry.kind === "plan"
            ? searchablePlanSegments(entry.planMarkdown, { cwd, math })
            : entry.role === "user"
              ? searchableUserMessageSegments(entry.text, { cwd, skills, math })
              : searchableAssistantMessageSegments(entry.text, streaming, { cwd, skills, math });
        if (cache.size >= MAX_CACHED_ENTRIES) cache.delete(cache.keys().next().value!);
        parses += 1;
        if (parses % PARSES_PER_YIELD === 0) yield* Effect.yieldNow;
      }
      cache.set(key, segments);
      documents.push({
        entryId: entry.entryId,
        turnId: entry.turnId,
        count: segments.reduce(
          (sum, segment) => sum + countThreadSearchOccurrences(segment, input.query),
          0,
        ),
      });
    }
    return selectThreadFindMatch(documents, input);
  });

  return ThreadFind.of({ search });
});

export const layer = Layer.effect(ThreadFind, make);
