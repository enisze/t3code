import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE scheduled_tasks (
      id TEXT PRIMARY KEY,
      config_json TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      next_run_at TEXT,
      webhook_token_hash TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX idx_scheduled_tasks_due ON scheduled_tasks(enabled, next_run_at)`;
  yield* sql`
    CREATE TABLE scheduled_task_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
      trigger TEXT NOT NULL,
      status TEXT NOT NULL,
      delivery_id TEXT,
      command_json TEXT,
      created_at TEXT NOT NULL,
      finished_at TEXT,
      error TEXT,
      UNIQUE(task_id, delivery_id)
    )
  `;
  yield* sql`CREATE INDEX idx_scheduled_task_runs_pending ON scheduled_task_runs(status, created_at)`;
  yield* sql`CREATE INDEX idx_scheduled_task_runs_task ON scheduled_task_runs(task_id, created_at DESC, id DESC)`;
});
