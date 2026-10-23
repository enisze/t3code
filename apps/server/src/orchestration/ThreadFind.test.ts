import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { ThreadId, TurnId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ThreadFind, layer as threadFindLayer, selectThreadFindMatch } from "./ThreadFind.ts";

const documents = (counts: ReadonlyArray<number>) =>
  counts.map((count, index) => ({
    entryId: `entry-${index}`,
    turnId: TurnId.make(`turn-${index}`),
    count,
  }));

describe("selectThreadFindMatch", () => {
  it("steps from a start entry and wraps around both ends", () => {
    const found = documents([2, 0, 3]);
    const at = (input: Parameters<typeof selectThreadFindMatch>[1]) => {
      const result = selectThreadFindMatch(found, input);
      return [result.activeIndex, result.match?.entryId, result.match?.occurrence];
    };

    assert.deepStrictEqual(at({}), [0, "entry-0", 0]);
    assert.deepStrictEqual(at({ start: { entryId: "entry-2", occurrence: 1 } }), [3, "entry-2", 1]);
    assert.deepStrictEqual(at({ start: { entryId: "entry-2", occurrence: 2 }, offset: 1 }), [
      0,
      "entry-0",
      0,
    ]);
    assert.deepStrictEqual(at({ start: { entryId: "entry-0", occurrence: 0 }, offset: -1 }), [
      4,
      "entry-2",
      2,
    ]);
    // An entry that no longer exists counts from the first match.
    assert.deepStrictEqual(at({ start: { entryId: "gone", occurrence: 1 } }), [0, "entry-0", 0]);
  });

  it("starts after an entry when the start is past its last match", () => {
    const result = selectThreadFindMatch(documents([2, 3]), {
      start: { entryId: "entry-0", occurrence: 2 },
    });
    assert.deepStrictEqual(result.match, {
      entryId: "entry-1",
      turnId: TurnId.make("turn-1"),
      occurrence: 0,
    });
  });

  it("returns the entries around the selection, skipping entries without matches", () => {
    const many = selectThreadFindMatch(documents(Array.from({ length: 30 }, () => 1)), {
      start: { entryId: "entry-0", occurrence: 0 },
    });
    assert.strictEqual(many.navigation.length, 17);
    assert.strictEqual(many.navigation[8]?.entryId, "entry-0");
    assert.strictEqual(many.navigation[0]?.entryId, "entry-22");

    const few = selectThreadFindMatch(documents([1, 0, 2]), {});
    assert.deepStrictEqual(
      few.navigation.map(({ entryId, startIndex, count }) => [entryId, startIndex, count]),
      [
        ["entry-0", 0, 1],
        ["entry-2", 1, 2],
      ],
    );
  });

  it("reports no match when nothing matches", () => {
    assert.deepStrictEqual(selectThreadFindMatch(documents([0, 0]), {}), {
      totalMatches: 0,
      activeIndex: 0,
      match: null,
      navigation: [],
    });
  });
});

const threadFindTestLayer = it.layer(
  threadFindLayer.pipe(
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(NodeServices.layer),
  ),
);

threadFindTestLayer("ThreadFind.search", (it) => {
  it.effect("counts what the timeline shows, in timeline order", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json, scripts_json,
          created_at, updated_at, deleted_at
        ) VALUES (
          'project-1', 'Project', '/repo', '{"provider":"codex","model":"gpt-5-codex"}', '[]',
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
          branch, worktree_path, linked_pull_request_json, branch_pull_request_json,
          latest_turn_id, latest_user_message_at, pending_approval_count,
          pending_user_input_count, has_actionable_proposed_plan, pinned_at, pin_order_key,
          created_at, updated_at, deleted_at
        ) VALUES (
          'thread-1', 'project-1', 'Thread', '{"provider":"codex","model":"gpt-5-codex"}',
          'full-access', 'default', NULL, '/repo/worktree', NULL, NULL, NULL, NULL, 0, 0, 0,
          NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL
        )
      `;
      const userText = [
        "Fix the README",
        "",
        "<terminal_context>",
        "- Terminal 1 lines 1-2:",
        "  README README",
        "</terminal_context>",
      ].join("\n");
      yield* sql`
        INSERT INTO projection_thread_messages (
          message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at
        ) VALUES
          ('user-1', 'thread-1', 'turn-1', 'user', ${userText}, 0,
            '2026-01-01T00:00:01.000Z', '2026-01-01T00:00:01.000Z'),
          ('assistant-1', 'thread-1', 'turn-1', 'assistant',
            'Updated [the readme](docs/README.md) twice: README.', 0,
            '2026-01-01T00:00:03.000Z', '2026-01-01T00:00:03.000Z'),
          ('system-1', 'thread-1', 'turn-1', 'system', 'README', 0,
            '2026-01-01T00:00:04.000Z', '2026-01-01T00:00:04.000Z')
      `;
      yield* sql`
        INSERT INTO projection_thread_proposed_plans (
          plan_id, thread_id, turn_id, plan_markdown, implemented_at, implementation_thread_id,
          created_at, updated_at
        ) VALUES (
          'plan-1', 'thread-1', 'turn-1', '# Rewrite the README', NULL, NULL,
          '2026-01-01T00:00:02.000Z', '2026-01-01T00:00:02.000Z'
        )
      `;

      const threadFind = yield* ThreadFind;
      const result = yield* threadFind.search({
        threadId: ThreadId.make("thread-1"),
        query: "readme",
      });

      // The terminal output and the system message are not shown; the file link
      // shows as its chip label, which resolves against the worktree.
      assert.deepStrictEqual(
        result.navigation.map(({ entryId, startIndex, count }) => [entryId, startIndex, count]),
        [
          ["user-1", 0, 1],
          ["plan-1", 1, 1],
          ["assistant-1", 2, 2],
        ],
      );
      assert.strictEqual(result.totalMatches, 4);
      assert.deepStrictEqual(result.match, {
        entryId: "user-1",
        turnId: TurnId.make("turn-1"),
        occurrence: 0,
      });

      const unknown = yield* threadFind.search({
        threadId: ThreadId.make("thread-missing"),
        query: "readme",
      });
      assert.strictEqual(unknown.totalMatches, 0);
    }),
  );
});
