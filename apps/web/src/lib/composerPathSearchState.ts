import {
  type ComposerPathSearchState,
  type ComposerPathSearchTarget,
} from "@t3tools/client-runtime/state/threads";

import { useComposerPathSearch as useComposerPathSearchQuery } from "../state/queries";

export function useComposerPathSearch(target: ComposerPathSearchTarget): ComposerPathSearchState {
  const state = useComposerPathSearchQuery(target);
  return {
    entries: state.entries,
    error: state.error,
    isPending: state.isPending,
  };
}
