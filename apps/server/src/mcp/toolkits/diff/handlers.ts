import {
  CommandId,
  DIFF_SHOWN_ACTIVITY_KIND,
  type DiffShownActivityPayload,
  EventId,
  type ShowDiffInput,
  type ThreadId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { DiffToolkit, ShowDiffError } from "./tools.ts";

/** Defaults the scope and drops an empty path filter, which would hide every file. */
export function toDiffShownPayload(input: ShowDiffInput): DiffShownActivityPayload {
  return {
    scope: input.scope ?? "all",
    ...(input.paths && input.paths.length > 0 ? { paths: input.paths } : {}),
  };
}

export const DiffToolkitHandlersLive = DiffToolkit.toLayer(
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

    /** Appends the activity, or returns false when the thread is gone. */
    const appendDiffShown = Effect.fn("DiffToolkit.appendDiffShown")(function* (
      threadId: ThreadId,
      payload: DiffShownActivityPayload,
    ) {
      const thread = yield* projectionSnapshotQuery
        .getThreadShellById(threadId)
        .pipe(Effect.map(Option.getOrUndefined));
      if (!thread) return false;
      const uuid = yield* crypto.randomUUIDv4;
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      yield* orchestrationEngine.dispatch({
        type: "thread.activity.append",
        commandId: CommandId.make(`server:show-diff:${uuid}`),
        threadId,
        activity: {
          id: EventId.make(uuid),
          tone: "info",
          kind: DIFF_SHOWN_ACTIVITY_KIND,
          summary: "Showed diff",
          payload,
          turnId: thread.session?.activeTurnId ?? null,
          createdAt,
        },
        createdAt,
      });
      return true;
    });

    return {
      // The diff itself never crosses the event stream: the activity only
      // records what to show, and the client renders it live from git.
      show_diff: Effect.fn("DiffToolkit.showDiff")(function* (input) {
        const { threadId } = yield* McpInvocationContext.McpInvocationContext;
        const appended = yield* appendDiffShown(threadId, toDiffShownPayload(input)).pipe(
          Effect.mapError((error) => new ShowDiffError({ message: error.message })),
        );
        if (!appended) {
          return yield* new ShowDiffError({ message: "This agent session has no T3 thread." });
        }
        return { shown: true };
      }),
    };
  }),
);
