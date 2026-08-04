import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

/** Maps a file path to the content signature it had when marked viewed. */
export type ViewedSignatures = Record<string, string>;

interface DiffViewedStoreState {
  /** Maps a diff scope key to the files marked viewed (path -> content signature). */
  viewedByScope: Record<string, ViewedSignatures>;
  setFileViewed: (scopeKey: string, filePath: string, signature: string, viewed: boolean) => void;
  clearScope: (scopeKey: string) => void;
}

const EMPTY_VIEWED_SIGNATURES: ViewedSignatures = {};

export const useDiffViewedStore = create<DiffViewedStoreState>()(
  persist(
    (set) => ({
      viewedByScope: {},
      setFileViewed: (scopeKey, filePath, signature, viewed) =>
        set((state) => {
          const current = state.viewedByScope[scopeKey] ?? EMPTY_VIEWED_SIGNATURES;
          if (viewed) {
            if (current[filePath] === signature) return state;
            return {
              viewedByScope: {
                ...state.viewedByScope,
                [scopeKey]: { ...current, [filePath]: signature },
              },
            };
          }
          if (!(filePath in current)) return state;
          const { [filePath]: _removed, ...rest } = current;
          return { viewedByScope: { ...state.viewedByScope, [scopeKey]: rest } };
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
      version: 2,
      migrate: (_persistedState, _version) => {
        // v1 keyed viewed files by whole-patch render key (an array of keys),
        // which is incompatible with the path -> signature schema. Drop it.
        return { viewedByScope: {} };
      },
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ viewedByScope: state.viewedByScope }),
    },
  ),
);

export function selectViewedSignatures(
  viewedByScope: Record<string, ViewedSignatures>,
  scopeKey: string | null,
): ViewedSignatures {
  if (scopeKey === null) return EMPTY_VIEWED_SIGNATURES;
  return viewedByScope[scopeKey] ?? EMPTY_VIEWED_SIGNATURES;
}
