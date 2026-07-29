import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

interface DiffViewedStoreState {
  /** Maps a diff scope key to the set of file keys marked as viewed. */
  viewedByScope: Record<string, string[]>;
  toggleFileViewed: (scopeKey: string, fileKey: string) => void;
  setFileViewed: (scopeKey: string, fileKey: string, viewed: boolean) => void;
  clearScope: (scopeKey: string) => void;
}

const EMPTY_VIEWED_FILE_KEYS: ReadonlyArray<string> = [];

export const useDiffViewedStore = create<DiffViewedStoreState>()(
  persist(
    (set) => ({
      viewedByScope: {},
      toggleFileViewed: (scopeKey, fileKey) =>
        set((state) => {
          const current = state.viewedByScope[scopeKey] ?? EMPTY_VIEWED_FILE_KEYS;
          const next = current.includes(fileKey)
            ? current.filter((key) => key !== fileKey)
            : [...current, fileKey];
          return { viewedByScope: { ...state.viewedByScope, [scopeKey]: next } };
        }),
      setFileViewed: (scopeKey, fileKey, viewed) =>
        set((state) => {
          const current = state.viewedByScope[scopeKey] ?? EMPTY_VIEWED_FILE_KEYS;
          const alreadyViewed = current.includes(fileKey);
          if (viewed === alreadyViewed) return state;
          const next = viewed
            ? [...current, fileKey]
            : current.filter((key) => key !== fileKey);
          return { viewedByScope: { ...state.viewedByScope, [scopeKey]: next } };
        }),
      clearScope: (scopeKey) =>
        set((state) => {
          if (!(scopeKey in state.viewedByScope)) return state;
          const { [scopeKey]: _removed, ...viewedByScope } = state.viewedByScope;
          return { viewedByScope };
        }),
    }),
    {
      name: "t3code:diff-viewed-state:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ viewedByScope: state.viewedByScope }),
    },
  ),
);

export function selectViewedFileKeys(
  viewedByScope: Record<string, string[]>,
  scopeKey: string | null,
): ReadonlyArray<string> {
  if (scopeKey === null) return EMPTY_VIEWED_FILE_KEYS;
  return viewedByScope[scopeKey] ?? EMPTY_VIEWED_FILE_KEYS;
}
