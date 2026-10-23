import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // A coalescing window is a pending run with a deadline. Its prompt holds the
  // latest delivery until the deadline turns it into a dispatchable command.
  yield* sql`ALTER TABLE scheduled_task_runs ADD COLUMN coalesce_key TEXT`;
  yield* sql`ALTER TABLE scheduled_task_runs ADD COLUMN due_at TEXT`;
  yield* sql`ALTER TABLE scheduled_task_runs ADD COLUMN prompt_text TEXT`;
  yield* sql`
    CREATE UNIQUE INDEX idx_scheduled_task_runs_open_window
      ON scheduled_task_runs(task_id, coalesce_key)
      WHERE status = 'pending' AND due_at IS NOT NULL
  `;
  yield* sql`
    CREATE INDEX idx_scheduled_task_runs_window_due
      ON scheduled_task_runs(due_at)
      WHERE status = 'pending' AND due_at IS NOT NULL
  `;
  // Deliveries that joined a window: retries of them stay duplicates, and the
  // rows bound how often a window's prompt is rewritten.
  yield* sql`
    CREATE TABLE scheduled_task_webhook_joins (
      id INTEGER PRIMARY KEY,
      task_id TEXT NOT NULL,
      run_id TEXT NOT NULL REFERENCES scheduled_task_runs(id) ON DELETE CASCADE,
      delivery_id TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(task_id, delivery_id)
    )
  `;
  yield* sql`CREATE INDEX idx_scheduled_task_webhook_joins_recent ON scheduled_task_webhook_joins(task_id, created_at)`;
  yield* sql`CREATE INDEX idx_scheduled_task_webhook_joins_run ON scheduled_task_webhook_joins(run_id)`;
});
