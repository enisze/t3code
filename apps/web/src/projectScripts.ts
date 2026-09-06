import {
  MAX_SCRIPT_ID_LENGTH,
  SCRIPT_RUN_COMMAND_PATTERN,
  type KeybindingCommand,
  type ProjectScript,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
const isScriptRunCommand = Schema.is(SCRIPT_RUN_COMMAND_PATTERN);

export interface ProjectScriptInput {
  readonly name: ProjectScript["name"];
  readonly command: ProjectScript["command"];
  readonly icon: ProjectScript["icon"];
  readonly runOnWorktreeCreate: ProjectScript["runOnWorktreeCreate"];
  readonly previewUrl: Exclude<ProjectScript["previewUrl"], undefined> | null;
  readonly autoOpenPreview: boolean;
}

export function buildProjectScript(id: string, input: ProjectScriptInput): ProjectScript {
  return {
    id,
    name: input.name,
    command: input.command,
    icon: input.icon,
    runOnWorktreeCreate: input.runOnWorktreeCreate,
    ...(input.previewUrl === null
      ? {}
      : {
          previewUrl: input.previewUrl,
          autoOpenPreview: input.autoOpenPreview,
        }),
  };
}

/**
 * Append a new script to a project's list. When the new script is a setup
 * script (`runOnWorktreeCreate`), any existing setup script is demoted so at
 * most one script runs on worktree creation.
 */
export function appendProjectScript(
  scripts: ReadonlyArray<ProjectScript>,
  input: ProjectScriptInput,
): { readonly scripts: ProjectScript[]; readonly script: ProjectScript } {
  const id = nextProjectScriptId(
    input.name,
    scripts.map((script) => script.id),
  );
  const script = buildProjectScript(id, input);
  const nextScripts = input.runOnWorktreeCreate
    ? [
        ...scripts.map((existing) =>
          existing.runOnWorktreeCreate ? { ...existing, runOnWorktreeCreate: false } : existing,
        ),
        script,
      ]
    : [...scripts, script];
  return { scripts: nextScripts, script };
}

/**
 * Replace an existing script by id, demoting any other setup script when the
 * replacement is a setup script. Returns `null` when `scriptId` isn't present.
 */
export function replaceProjectScript(
  scripts: ReadonlyArray<ProjectScript>,
  scriptId: string,
  input: ProjectScriptInput,
): ProjectScript[] | null {
  const existing = scripts.find((script) => script.id === scriptId);
  if (!existing) return null;
  const updated = buildProjectScript(existing.id, input);
  return scripts.map((script) =>
    script.id === scriptId
      ? updated
      : input.runOnWorktreeCreate
        ? { ...script, runOnWorktreeCreate: false }
        : script,
  );
}

function normalizeScriptId(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (cleaned.length === 0) {
    return "script";
  }
  if (cleaned.length <= MAX_SCRIPT_ID_LENGTH) {
    return cleaned;
  }
  return cleaned.slice(0, MAX_SCRIPT_ID_LENGTH).replace(/-+$/g, "") || "script";
}

export const commandForProjectScript = (scriptId: string): KeybindingCommand =>
  SCRIPT_RUN_COMMAND_PATTERN.make(`script.${scriptId}.run`);

export function projectScriptIdFromCommand(command: string): string | null {
  const trimmed = command.trim();
  if (!isScriptRunCommand(trimmed)) {
    return null;
  }
  const [prefix, , suffix] = SCRIPT_RUN_COMMAND_PATTERN.parts;
  return trimmed.slice(prefix.literal.length, -suffix.literal.length);
}

export function nextProjectScriptId(name: string, existingIds: Iterable<string>): string {
  const taken = new Set(Array.from(existingIds));
  const baseId = normalizeScriptId(name);
  if (!taken.has(baseId)) return baseId;

  let suffix = 2;
  while (suffix < 10_000) {
    const candidate = `${baseId}-${suffix}`;
    const safeCandidate =
      candidate.length <= MAX_SCRIPT_ID_LENGTH
        ? candidate
        : `${baseId.slice(0, Math.max(1, MAX_SCRIPT_ID_LENGTH - String(suffix).length - 1))}-${suffix}`;
    if (!taken.has(safeCandidate)) {
      return safeCandidate;
    }
    suffix += 1;
  }

  // This last-resort fallback only triggers after exhausting thousands of suffixes.
  return `${baseId}-${Date.now()}`.slice(0, MAX_SCRIPT_ID_LENGTH);
}

export function primaryProjectScript(scripts: ReadonlyArray<ProjectScript>): ProjectScript | null {
  const regular = scripts.find((script) => !script.runOnWorktreeCreate);
  return regular ?? scripts[0] ?? null;
}

/**
 * Prefix for terminal ids owned by the right-panel "Run" tasks surface. Task
 * terminals are kept out of the general terminal drawer so a project's
 * setup/run tasks each get a stable, dedicated terminal that survives re-runs.
 */
export const TASK_TERMINAL_ID_PREFIX = "task-";

/** Fixed terminal id for the plain shell tab inside the tasks surface. */
export const TASK_SHELL_TERMINAL_ID = "task-shell";

/** Stable terminal id for a project script's dedicated task terminal. */
export const taskTerminalId = (scriptId: string): string => `${TASK_TERMINAL_ID_PREFIX}${scriptId}`;

/** Whether a terminal id belongs to the tasks surface (a task or its shell). */
export const isTaskTerminalId = (terminalId: string): boolean =>
  terminalId.startsWith(TASK_TERMINAL_ID_PREFIX);
