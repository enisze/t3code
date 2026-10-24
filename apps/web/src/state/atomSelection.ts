import type { Atom } from "effect/unstable/reactivity";
import { useCallback, useSyncExternalStore } from "react";

import { appAtomRegistry } from "../rpc/atomRegistry";

/**
 * One value derived from an atom, re-rendering only when that value changes (by
 * `Object.is`). For views that need a single fact from an atom that updates
 * often, such as the thread shells while a reply streams. `select` must return
 * a primitive or another value that stays identical while unchanged; `fallback`
 * is the value while there is no atom.
 */
export function useAtomSelection<A, T>(
  atom: Atom.Atom<A> | null,
  select: (value: A) => T,
  fallback: T,
): T {
  const subscribe = useCallback(
    (onChange: () => void) =>
      atom === null ? () => {} : appAtomRegistry.subscribe(atom, () => onChange()),
    [atom],
  );
  const getSnapshot = () => (atom === null ? fallback : select(appAtomRegistry.get(atom)));
  // Static rendering, as in component tests, reads the same snapshot.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
