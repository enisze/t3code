import { it } from "@effect/vitest";
import {
  type EnvironmentId,
  type OrchestrationCommand,
  type OrchestrationThreadShell,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { describe, expect } from "vite-plus/test";

import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { DiffToolkitHandlersLive, toDiffShownPayload } from "./handlers.ts";
import { DiffToolkit } from "./tools.ts";

const THREAD_ID = ThreadId.make("diff-thread");
const TURN_ID = TurnId.make("diff-turn");

const testCrypto = Crypto.make({
  randomBytes: (size) => new Uint8Array(size).fill(1),
  digest: (_algorithm, data) => Effect.succeed(data),
});

const invocation: McpInvocationContext.McpInvocationScope = {
  environmentId: "environment" as EnvironmentId,
  threadId: THREAD_ID,
  providerSessionId: "provider-session",
  providerInstanceId: ProviderInstanceId.make("claude"),
  capabilities: new Set(["preview"]),
  issuedAt: 0,
};

const callShowDiff = (
  input: Parameters<typeof toDiffShownPayload>[0],
  thread: OrchestrationThreadShell | undefined,
) => {
  const dispatched: OrchestrationCommand[] = [];
  const layer = DiffToolkitHandlersLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(Crypto.Crypto, testCrypto),
        Layer.mock(OrchestrationEngineService)({
          dispatch: (command) =>
            Effect.sync(() => {
              dispatched.push(command);
              return { sequence: dispatched.length };
            }),
        }),
        Layer.mock(ProjectionSnapshotQuery)({
          getThreadShellById: () => Effect.succeed(Option.fromNullishOr(thread)),
        }),
      ),
    ),
  );
  return Effect.gen(function* () {
    const toolkit = yield* DiffToolkit;
    const exit = yield* toolkit
      .handle("show_diff", input)
      .pipe(
        Stream.unwrap,
        Stream.run(Sink.last()),
        Effect.flatMap(Effect.fromOption),
        Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
        Effect.exit,
      );
    return { exit, dispatched };
  }).pipe(Effect.provide(layer));
};

describe("show_diff", () => {
  it.effect("appends a diff.shown activity to the invoking thread's active turn", () =>
    Effect.gen(function* () {
      // Only the session's active turn is read from the shell.
      const thread = { session: { activeTurnId: TURN_ID } } as OrchestrationThreadShell;
      const { exit, dispatched } = yield* callShowDiff(
        { scope: "unstaged", paths: ["src/app.ts"] },
        thread,
      );
      expect(exit._tag).toBe("Success");
      expect(dispatched).toHaveLength(1);
      const command = dispatched[0];
      expect(command?.type).toBe("thread.activity.append");
      if (command?.type !== "thread.activity.append") return;
      expect(command.threadId).toBe(THREAD_ID);
      expect(command.activity).toMatchObject({
        kind: "diff.shown",
        tone: "info",
        turnId: TURN_ID,
        payload: { scope: "unstaged", paths: ["src/app.ts"] },
      });
    }),
  );

  it.effect("fails without dispatching when the thread is gone", () =>
    Effect.gen(function* () {
      const { exit, dispatched } = yield* callShowDiff({}, undefined);
      expect(exit._tag).toBe("Failure");
      expect(dispatched).toHaveLength(0);
    }),
  );
});

describe("toDiffShownPayload", () => {
  it("defaults to every change and drops an empty path filter", () => {
    expect(toDiffShownPayload({})).toEqual({ scope: "all" });
    expect(toDiffShownPayload({ scope: "branch", paths: [] })).toEqual({ scope: "branch" });
  });
});
