import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ScheduledTask,
  type ScheduledTaskInput,
  type ScheduledTaskRun,
  ThreadId,
} from "@t3tools/contracts";
import {
  type AtomCommandResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import {
  useEnvironments,
  useEnvironmentHttpBaseUrl,
  type EnvironmentPresentation,
} from "../../state/environments";
import { useThreadShells } from "../../state/entities";
import { useEnvironmentSessionState } from "../../state/session";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { scheduledTaskEnvironment } from "../../state/scheduledTasks";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Switch } from "../ui/switch";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";

const selectClass = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm";
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function scheduleLabel(task: ScheduledTask) {
  const schedule = task.schedule;
  if (schedule.type === "webhook") return "On webhook";
  if (schedule.type === "interval") return `Every ${schedule.everyMs / 60_000} minutes`;
  const days =
    schedule.weekdays.length === 0
      ? "Daily"
      : schedule.weekdays.map((day) => weekdays[day]).join(", ");
  return `${days} at ${schedule.timeOfDay} (${schedule.timeZone})`;
}

export function AutomationsSettings() {
  const { environments } = useEnvironments();
  const [selected, setSelected] = useState<EnvironmentId | null>(null);
  const supported = environments.filter(
    (environment) => environment.serverConfig?.environment.capabilities.scheduledTasks === true,
  );
  const environment = supported.find((item) => item.environmentId === selected) ?? supported[0];
  return (
    <SettingsPageContainer>
      <SettingsSection
        id="automations"
        title="Automations"
        description="Run a saved prompt on a schedule or when a webhook arrives. The owning environment must be running; clients can be closed."
      >
        <div className="space-y-4 p-4">
          {environment ? (
            <>
              <label className="block space-y-1 text-sm">
                <span>Environment</span>
                <select
                  className={selectClass}
                  value={environment.environmentId}
                  onChange={(event) => setSelected(event.target.value as EnvironmentId)}
                >
                  {supported.map((item) => (
                    <option key={item.environmentId} value={item.environmentId}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <EnvironmentAutomations key={environment.environmentId} environment={environment} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Connect to an environment with automation support to get started.
            </p>
          )}
        </div>
      </SettingsSection>
    </SettingsPageContainer>
  );
}

function EnvironmentAutomations({ environment }: { environment: EnvironmentPresentation }) {
  const environmentId = environment.environmentId;
  const tasks = useEnvironmentQuery(scheduledTaskEnvironment.list({ environmentId, input: {} }));
  const session = useEnvironmentSessionState(environmentId);
  const canOperate =
    environment.connection.phase === "connected" &&
    session.data?.scopes?.includes(AuthOrchestrationOperateScope) === true;
  const httpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const allThreads = useThreadShells();
  const threads = allThreads.filter(
    (thread) => thread.environmentId === environmentId && thread.archivedAt === null,
  );
  const [editor, setEditor] = useState<ScheduledTask | "new" | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [webhookPath, setWebhookPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = useAtomCommand(scheduledTaskEnvironment.save);
  const remove = useAtomCommand(scheduledTaskEnvironment.remove);
  const setEnabled = useAtomCommand(scheduledTaskEnvironment.setEnabled);
  const runNow = useAtomCommand(scheduledTaskEnvironment.runNow);
  const rotate = useAtomCommand(scheduledTaskEnvironment.rotateWebhook);
  const { copyToClipboard } = useCopyToClipboard();

  async function perform<A, E>(
    work: () => Promise<AtomCommandResult<A, E>>,
    onSuccess?: (value: A) => void,
  ) {
    setBusy(true);
    setError(null);
    try {
      const result = await work();
      if (result._tag === "Success") onSuccess?.(result.value);
      else {
        const failure = squashAtomCommandFailure(result);
        setError(failure instanceof Error ? failure.message : "The automation operation failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  // Relay client URLs require device authentication. Webhook senders need a
  // direct reachable server origin, rather than the client's relay proxy URL.
  const webhookUrl =
    webhookPath === null
      ? null
      : httpBaseUrl === null || environment.relayManaged
        ? webhookPath
        : new URL(webhookPath, httpBaseUrl).href;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button
          disabled={!canOperate || busy || threads.length === 0}
          onClick={() => setEditor("new")}
        >
          New automation
        </Button>
        <Button variant="outline" disabled={tasks.isPending} onClick={tasks.refresh}>
          Refresh
        </Button>
      </div>
      {threads.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Create a thread first. Automations use its current model, workspace, and permissions.
        </p>
      )}
      {!canOperate && (
        <p className="text-sm text-muted-foreground">
          A connected session with permission to operate threads is required to manage automations.
        </p>
      )}
      {(error ?? tasks.error) && (
        <p role="alert" className="text-sm text-destructive">
          {error ?? tasks.error}
        </p>
      )}
      {webhookUrl && (
        <div className="space-y-2 rounded-lg border p-3 text-sm">
          <p>Save this secret webhook URL now. Rotating it invalidates the previous URL.</p>
          {environment.relayManaged && (
            <p className="text-muted-foreground">
              Append this path to a directly reachable server origin, such as your Tailscale
              address. The client relay URL cannot receive external webhooks.
            </p>
          )}
          <Input type="password" readOnly aria-label="Secret webhook URL" value={webhookUrl} />
          <Button
            variant="outline"
            onClick={() => {
              copyToClipboard(webhookUrl, undefined);
            }}
          >
            Copy webhook {environment.relayManaged ? "path" : "URL"}
          </Button>
          <Button variant="ghost" onClick={() => setWebhookPath(null)}>
            Dismiss
          </Button>
        </div>
      )}
      {editor !== null && (
        <AutomationEditor
          key={editor === "new" ? "new" : editor.id}
          task={editor === "new" ? null : editor}
          threads={threads}
          busy={busy}
          onCancel={() => setEditor(null)}
          onSave={(input) => {
            void perform(
              () => save({ environmentId, input }),
              (result) => {
                setEditor(null);
                if (result.webhookPath) setWebhookPath(result.webhookPath);
              },
            );
          }}
        />
      )}
      {tasks.isPending && tasks.data === null && (
        <p className="text-sm text-muted-foreground">Loading automations…</p>
      )}
      {tasks.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">No automations in this environment.</p>
      )}
      {tasks.data?.map((task) => (
        <div key={task.id} className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">{task.name}</span>
            <Switch
              aria-label={`Enable ${task.name}`}
              checked={task.enabled}
              disabled={!canOperate || busy}
              onCheckedChange={(enabled) => {
                void perform(() => setEnabled({ environmentId, input: { id: task.id, enabled } }));
              }}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {scheduleLabel(task)} · {task.enabled ? "Enabled" : "Paused"}
          </p>
          <Link
            to="/$environmentId/$threadId"
            params={{ environmentId, threadId: task.threadId }}
            className="text-sm text-primary underline"
          >
            {threads.find((thread) => thread.id === task.threadId)?.title ?? "Open thread"}
          </Link>
          {task.nextRunAt && task.enabled && (
            <p className="text-xs text-muted-foreground">
              Next run: {new Date(task.nextRunAt).toLocaleString()}
            </p>
          )}
          {task.lastRun && <RunStatus run={task.lastRun} />}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!canOperate || busy}
              onClick={() => setEditor(task)}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!canOperate || busy}
              onClick={() => {
                void perform(() => runNow({ environmentId, input: { id: task.id } }));
              }}
            >
              Run now
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setHistoryId(historyId === task.id ? null : task.id)}
            >
              History
            </Button>
            {task.schedule.type === "webhook" && (
              <Button
                size="sm"
                variant="outline"
                disabled={!canOperate || busy}
                onClick={() => {
                  void perform(
                    () => rotate({ environmentId, input: { id: task.id } }),
                    (value) => setWebhookPath(value.webhookPath),
                  );
                }}
              >
                Rotate webhook URL
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={!canOperate || busy}
              onClick={() => {
                void perform(() => remove({ environmentId, input: { id: task.id } }));
              }}
            >
              Delete
            </Button>
          </div>
          {historyId === task.id && (
            <AutomationHistory environmentId={environmentId} id={task.id} />
          )}
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        Busy threads are skipped. Interval runs missed during downtime are coalesced into one run;
        fixed-time runs over ten minutes late are skipped. “Started” means the prompt was sent;
        check the thread for the result.
      </p>
    </div>
  );
}

function RunStatus({ run }: { run: ScheduledTaskRun }) {
  return (
    <p className="text-xs text-muted-foreground">
      {new Date(run.createdAt).toLocaleString()} · {run.trigger} · {run.status}
      {run.error ? ` — ${run.error}` : ""}
    </p>
  );
}

function AutomationHistory({ environmentId, id }: { environmentId: EnvironmentId; id: string }) {
  const history = useEnvironmentQuery(
    scheduledTaskEnvironment.history({ environmentId, input: { id } }),
  );
  return (
    <div className="max-h-60 space-y-2 overflow-y-auto border-t pt-2">
      {history.error && (
        <p role="alert" className="text-xs text-destructive">
          {history.error}
        </p>
      )}
      {history.data?.length === 0 && <p className="text-xs text-muted-foreground">No runs yet.</p>}
      {history.data?.map((run) => (
        <RunStatus key={run.id} run={run} />
      ))}
    </div>
  );
}

function AutomationEditor({
  task,
  threads,
  busy,
  onCancel,
  onSave,
}: {
  task: ScheduledTask | null;
  threads: ReadonlyArray<{ id: ThreadId; title: string }>;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: ScheduledTaskInput) => void;
}) {
  const [name, setName] = useState(task?.name ?? "");
  const [threadId, setThreadId] = useState(task?.threadId ?? threads[0]?.id ?? "");
  const [prompt, setPrompt] = useState(task?.prompt ?? "");
  const [kind, setKind] = useState<ScheduledTaskInput["schedule"]["type"]>(
    task?.schedule.type ?? "interval",
  );
  const [minutes, setMinutes] = useState(
    task?.schedule.type === "interval" ? String(task.schedule.everyMs / 60_000) : "60",
  );
  const [time, setTime] = useState(
    task?.schedule.type === "fixed_time" ? task.schedule.timeOfDay : "09:00",
  );
  const [zone, setZone] = useState(() =>
    task?.schedule.type === "fixed_time"
      ? task.schedule.timeZone
      : new Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [days, setDays] = useState<ReadonlyArray<number>>(
    task?.schedule.type === "fixed_time" ? task.schedule.weekdays : [],
  );
  return (
    <form
      className="space-y-3 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          ...(task === null ? {} : { id: task.id }),
          name,
          threadId: ThreadId.make(threadId),
          prompt,
          enabled: task?.enabled ?? true,
          schedule:
            kind === "interval"
              ? { type: "interval", everyMs: Number(minutes) * 60_000 }
              : kind === "webhook"
                ? { type: "webhook" }
                : { type: "fixed_time", timeOfDay: time, timeZone: zone, weekdays: days },
        });
      }}
    >
      <label className="block space-y-1 text-sm">
        <span>Name</span>
        <Input
          required
          maxLength={200}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Thread</span>
        <select
          required
          className={selectClass}
          value={threadId}
          onChange={(event) => setThreadId(event.target.value)}
        >
          {!threads.some((thread) => thread.id === threadId) && (
            <option value="">Choose an active thread</option>
          )}
          {threads.map((thread) => (
            <option key={thread.id} value={thread.id}>
              {thread.title}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1 text-sm">
        <span>Prompt</span>
        <Textarea
          required
          maxLength={32_768}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Trigger</span>
        <select
          className={selectClass}
          value={kind}
          onChange={(event) => setKind(event.target.value as typeof kind)}
        >
          <option value="interval">Interval</option>
          <option value="fixed_time">Time of day</option>
          <option value="webhook">Webhook</option>
        </select>
      </label>
      {kind === "interval" && (
        <label className="block space-y-1 text-sm">
          <span>Every (minutes)</span>
          <Input
            required
            type="number"
            min={1}
            max={525600}
            step="any"
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
          />
        </label>
      )}
      {kind === "fixed_time" && (
        <>
          <label className="block space-y-1 text-sm">
            <span>Time</span>
            <Input
              required
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Time zone</span>
            <Input
              required
              placeholder="Europe/Berlin"
              value={zone}
              onChange={(event) => setZone(event.target.value)}
            />
          </label>
          <fieldset className="space-y-2">
            <legend className="text-sm">Days (none selected means every day)</legend>
            <div className="flex flex-wrap gap-2">
              {weekdays.map((day, index) => (
                <label key={day} className="flex gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={days.includes(index)}
                    onChange={(event) =>
                      setDays(
                        event.target.checked
                          ? [...days, index]
                          : days.filter((value) => value !== index),
                      )
                    }
                  />
                  {day}
                </label>
              ))}
            </div>
          </fieldset>
        </>
      )}
      {kind === "webhook" && (
        <p className="text-xs text-muted-foreground">
          Send JSON to the secret URL generated on save. Use {"{{payload}}"} in the prompt to place
          the payload; otherwise it is appended. Set X-Webhook-Id or X-GitHub-Delivery to
          deduplicate retries against the last 50 runs.
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          Save automation
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
