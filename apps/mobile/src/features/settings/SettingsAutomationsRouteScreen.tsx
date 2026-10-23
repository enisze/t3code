import { useState } from "react";
import { Alert, Platform, Pressable, ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Option from "effect/Option";
import {
  AuthOrchestrationOperateScope,
  ThreadId,
  type ScheduledTask,
  type ScheduledTaskInput,
  type ScheduledTaskRun,
} from "@t3tools/contracts";
import {
  type AtomCommandResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useEnvironments, type EnvironmentPresentation } from "../../state/environments";
import { useThreadShells } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { environmentSession, usePreparedConnection } from "../../state/session";
import { scheduledTaskEnvironment } from "../../state/scheduledTasks";
import { copyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

function Action({
  label,
  disabled = false,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      className={
        disabled ? "rounded-lg bg-input px-3 py-2 opacity-40" : "rounded-lg bg-input px-3 py-2"
      }
    >
      <Text className="text-sm text-foreground">{label}</Text>
    </Pressable>
  );
}

export function SettingsAutomationsRouteScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { environments } = useEnvironments();
  const [selected, setSelected] = useState<string | null>(null);
  const supported = environments.filter(
    (item) => item.serverConfig?.environment.capabilities.scheduledTasks === true,
  );
  const environment = supported.find((item) => item.environmentId === selected) ?? supported[0];
  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" && (
        <>
          <NativeStackScreenOptions options={{ headerShown: false }} />
          <AndroidScreenHeader title="Automations" onBack={() => navigation.goBack()} />
        </>
      )}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        className="flex-1"
        contentContainerClassName="gap-5 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-sm text-foreground-muted">
          Run prompts on a schedule or webhook. The owning environment must be running; this app can
          be closed.
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {supported.map((item) => (
            <Action
              key={item.environmentId}
              label={`${item.environmentId === environment?.environmentId ? "✓ " : ""}${item.label}`}
              onPress={() => setSelected(item.environmentId)}
            />
          ))}
        </View>
        {environment ? (
          <EnvironmentAutomations key={environment.environmentId} environment={environment} />
        ) : (
          <Text className="text-sm text-foreground-muted">
            Connect to an environment with automation support.
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

function EnvironmentAutomations({ environment }: { environment: EnvironmentPresentation }) {
  const environmentId = environment.environmentId;
  const tasks = useEnvironmentQuery(scheduledTaskEnvironment.list({ environmentId, input: {} }));
  const session = useEnvironmentQuery(environmentSession.sessionStateAtom(environmentId));
  const prepared = usePreparedConnection(environmentId);
  const canOperate =
    environment.connection.phase === "connected" &&
    session.data?.scopes?.includes(AuthOrchestrationOperateScope) === true;
  const threads = useThreadShells().filter(
    (thread) => thread.environmentId === environmentId && thread.archivedAt === null,
  );
  const [editor, setEditor] = useState<ScheduledTask | "new" | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [webhookPath, setWebhookPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = useAtomCommand(scheduledTaskEnvironment.save);
  const remove = useAtomCommand(scheduledTaskEnvironment.remove);
  const toggle = useAtomCommand(scheduledTaskEnvironment.setEnabled);
  const runNow = useAtomCommand(scheduledTaskEnvironment.runNow);
  const rotate = useAtomCommand(scheduledTaskEnvironment.rotateWebhook);
  async function perform<A, E>(
    work: () => Promise<AtomCommandResult<A, E>>,
    onSuccess?: (value: A) => void,
  ) {
    setBusy(true);
    try {
      const result = await work();
      if (result._tag === "Success") onSuccess?.(result.value);
      else {
        const error = squashAtomCommandFailure(result);
        Alert.alert("Automation failed", error instanceof Error ? error.message : "Try again.");
      }
    } finally {
      setBusy(false);
    }
  }
  const webhookUrl =
    webhookPath === null
      ? null
      : environment.relayManaged || Option.isNone(prepared)
        ? webhookPath
        : new URL(webhookPath, prepared.value.httpBaseUrl).href;
  return (
    <View className="gap-4">
      <View className="flex-row gap-2">
        <Action
          label="New automation"
          disabled={!canOperate || busy || threads.length === 0}
          onPress={() => setEditor("new")}
        />
        <Action label="Refresh" disabled={tasks.isPending} onPress={tasks.refresh} />
      </View>
      {!canOperate && (
        <Text className="text-sm text-foreground-muted">
          A connected session with permission to operate threads is required to make changes.
        </Text>
      )}
      {tasks.error && (
        <Text accessibilityRole="alert" className="text-sm text-destructive">
          {tasks.error}
        </Text>
      )}
      {tasks.isPending && tasks.data === null && (
        <Text className="text-sm text-foreground-muted">Loading automations…</Text>
      )}
      {tasks.data?.length === 0 && (
        <Text className="text-sm text-foreground-muted">
          No automations. Create a thread first, then choose a trigger and prompt.
        </Text>
      )}
      {webhookUrl && (
        <SettingsSection title="Secret webhook URL">
          <View className="gap-3 p-4">
            <Text className="text-sm text-foreground-muted">
              Save this URL now. Rotating invalidates the old URL.
              {environment.relayManaged
                ? " Append this path to a directly reachable server origin, such as Tailscale. Client relay URLs cannot receive external webhooks."
                : ""}
            </Text>
            <Action
              label={environment.relayManaged ? "Copy secret path" : "Copy secret URL"}
              onPress={() => copyTextWithHaptic(webhookUrl)}
            />
            <Action label="Dismiss" onPress={() => setWebhookPath(null)} />
          </View>
        </SettingsSection>
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
      {tasks.data?.map((task) => (
        <SettingsSection key={task.id} title={task.name}>
          <SettingsSwitchRow
            icon="timer"
            label={task.enabled ? "Enabled" : "Paused"}
            value={task.enabled}
            disabled={!canOperate || busy}
            onValueChange={(enabled) => {
              void perform(() => toggle({ environmentId, input: { id: task.id, enabled } }));
            }}
          />
          <View className="gap-3 px-4 pb-4">
            <Text className="text-sm text-foreground-muted">
              {task.schedule.type === "webhook"
                ? "On webhook"
                : task.schedule.type === "interval"
                  ? `Every ${task.schedule.everyMs / 60_000} minutes`
                  : `${task.schedule.timeOfDay} (${task.schedule.timeZone})`}
            </Text>
            <Text className="text-sm text-foreground">
              Thread:{" "}
              {threads.find((thread) => thread.id === task.threadId)?.title ?? task.threadId}
            </Text>
            {task.enabled && task.nextRunAt && (
              <Text className="text-xs text-foreground-muted">
                Next: {new Date(task.nextRunAt).toLocaleString()}
              </Text>
            )}
            {task.lastRun && <RunStatus run={task.lastRun} />}
            <View className="flex-row flex-wrap gap-2">
              <Action label="Edit" disabled={!canOperate || busy} onPress={() => setEditor(task)} />
              <Action
                label="Run now"
                disabled={!canOperate || busy}
                onPress={() => {
                  void perform(() => runNow({ environmentId, input: { id: task.id } }));
                }}
              />
              <Action
                label="History"
                onPress={() => setHistoryId(historyId === task.id ? null : task.id)}
              />
              {task.schedule.type === "webhook" && (
                <Action
                  label="Rotate webhook URL"
                  disabled={!canOperate || busy}
                  onPress={() => {
                    void perform(
                      () => rotate({ environmentId, input: { id: task.id } }),
                      (value) => setWebhookPath(value.webhookPath),
                    );
                  }}
                />
              )}
              <Action
                label="Delete"
                disabled={!canOperate || busy}
                onPress={() => {
                  void perform(() => remove({ environmentId, input: { id: task.id } }));
                }}
              />
            </View>
            {historyId === task.id && (
              <AutomationHistory environmentId={environmentId} id={task.id} />
            )}
          </View>
        </SettingsSection>
      ))}
      <Text className="text-xs text-foreground-muted">
        Busy threads are skipped. Missed intervals coalesce into one run; fixed-time runs over ten
        minutes late are skipped. “Started” means the prompt was sent; check the thread for results.
      </Text>
    </View>
  );
}

function RunStatus({ run }: { run: ScheduledTaskRun }) {
  return (
    <Text className="text-xs text-foreground-muted">
      {new Date(run.createdAt).toLocaleString()} · {run.trigger} · {run.status}
      {run.error ? ` — ${run.error}` : ""}
    </Text>
  );
}
function AutomationHistory({
  environmentId,
  id,
}: {
  environmentId: EnvironmentPresentation["environmentId"];
  id: string;
}) {
  const history = useEnvironmentQuery(
    scheduledTaskEnvironment.history({ environmentId, input: { id } }),
  );
  return (
    <View className="gap-2">
      {history.error && <Text className="text-sm text-destructive">{history.error}</Text>}
      {history.data?.length === 0 && (
        <Text className="text-sm text-foreground-muted">No runs yet.</Text>
      )}
      {history.data?.map((run) => (
        <RunStatus key={run.id} run={run} />
      ))}
    </View>
  );
}

function AutomationEditor({
  task,
  threads,
  busy,
  onSave,
  onCancel,
}: {
  task: ScheduledTask | null;
  threads: ReadonlyArray<{ id: ThreadId; title: string }>;
  busy: boolean;
  onSave: (input: ScheduledTaskInput) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(task?.name ?? "");
  const [prompt, setPrompt] = useState(task?.prompt ?? "");
  const [threadId, setThreadId] = useState(task?.threadId ?? threads[0]?.id ?? "");
  const [search, setSearch] = useState("");
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
  const fieldClass = "rounded-lg border border-border bg-input px-3 py-2 text-base text-foreground";
  const matches = threads
    .filter((thread) => thread.title.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 10);
  return (
    <SettingsSection title={task === null ? "New automation" : "Edit automation"}>
      <View className="gap-3 p-4">
        <TextInput
          accessibilityLabel="Name"
          placeholder="Name"
          className={fieldClass}
          maxLength={200}
          value={name}
          onChangeText={setName}
        />
        <Text className="text-sm text-foreground">
          Thread:{" "}
          {threads.find((thread) => thread.id === threadId)?.title ?? "Choose an active thread"}
        </Text>
        <TextInput
          accessibilityLabel="Find thread"
          placeholder="Find thread"
          className={fieldClass}
          value={search}
          onChangeText={setSearch}
        />
        {matches.map((thread) => (
          <Action
            key={thread.id}
            label={`${thread.id === threadId ? "✓ " : ""}${thread.title}`}
            onPress={() => setThreadId(thread.id)}
          />
        ))}
        <TextInput
          accessibilityLabel="Prompt"
          placeholder="Prompt"
          className={fieldClass}
          multiline
          style={{ minHeight: 100 }}
          maxLength={32_768}
          value={prompt}
          onChangeText={setPrompt}
        />
        <View className="flex-row flex-wrap gap-2">
          {(["interval", "fixed_time", "webhook"] as const).map((value) => (
            <Action
              key={value}
              label={`${value === kind ? "✓ " : ""}${value === "interval" ? "Interval" : value === "fixed_time" ? "Time of day" : "Webhook"}`}
              onPress={() => setKind(value)}
            />
          ))}
        </View>
        {kind === "interval" && (
          <>
            <Text className="text-sm text-foreground">Every (minutes, minimum 1)</Text>
            <TextInput
              accessibilityLabel="Interval minutes"
              className={fieldClass}
              keyboardType="decimal-pad"
              value={minutes}
              onChangeText={setMinutes}
            />
          </>
        )}
        {kind === "fixed_time" && (
          <>
            <TextInput
              accessibilityLabel="Time (HH:MM)"
              placeholder="09:00"
              className={fieldClass}
              value={time}
              onChangeText={setTime}
            />
            <TextInput
              accessibilityLabel="IANA time zone"
              placeholder="Europe/Berlin"
              className={fieldClass}
              autoCapitalize="none"
              value={zone}
              onChangeText={setZone}
            />
            <Text className="text-xs text-foreground-muted">
              Days (none selected means every day)
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, index) => (
                <Action
                  key={day}
                  label={`${days.includes(index) ? "✓ " : ""}${day}`}
                  onPress={() =>
                    setDays(
                      days.includes(index)
                        ? days.filter((value) => value !== index)
                        : [...days, index],
                    )
                  }
                />
              ))}
            </View>
          </>
        )}
        {kind === "webhook" && (
          <Text className="text-xs text-foreground-muted">
            Send JSON to the secret URL generated on save. {"{{payload}}"} inserts the body in your
            prompt; otherwise it is appended. X-Webhook-Id or X-GitHub-Delivery deduplicates retries
            against the last 50 runs.
          </Text>
        )}
        <Text className="text-xs text-foreground-muted">
          Uses the thread’s current model, workspace, and permissions.
        </Text>
        <View className="flex-row gap-2">
          <Action
            label="Save automation"
            disabled={busy || !name.trim() || !prompt.trim() || !threadId}
            onPress={() =>
              onSave({
                ...(task === null ? {} : { id: task.id }),
                name,
                prompt,
                threadId: ThreadId.make(threadId),
                enabled: task?.enabled ?? true,
                schedule:
                  kind === "interval"
                    ? { type: "interval", everyMs: Number(minutes) * 60_000 }
                    : kind === "webhook"
                      ? { type: "webhook" }
                      : { type: "fixed_time", timeOfDay: time, timeZone: zone, weekdays: days },
              })
            }
          />
          <Action label="Cancel" disabled={busy} onPress={onCancel} />
        </View>
      </View>
    </SettingsSection>
  );
}
