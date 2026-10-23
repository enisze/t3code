import type {
  OrchestrationSearchThreadInput,
  OrchestrationThreadFindMatch,
} from "@t3tools/contracts";

export type ThreadFindStart = NonNullable<OrchestrationSearchThreadInput["start"]>;
export type ThreadFindPositionReader = (query: string) => ThreadFindStart | undefined;

/** One occurrence of the query inside a message or plan, and the turn to unfold for it. */
export type ThreadFindMatch = OrchestrationThreadFindMatch;

function clampThreadFindIndex(index: number, total: number): number {
  if (total <= 0 || !Number.isFinite(index) || index < 0) return 0;
  return Math.min(Math.trunc(index), total - 1);
}

export function stepThreadFindIndex(index: number, total: number, delta: number): number {
  if (total <= 0) return 0;
  const clamped = clampThreadFindIndex(index, total);
  return (((clamped + delta) % total) + total) % total;
}

export function formatThreadFindCount(index: number, total: number): string {
  return total <= 0 ? "0/0" : `${clampThreadFindIndex(index, total) + 1}/${total}`;
}
