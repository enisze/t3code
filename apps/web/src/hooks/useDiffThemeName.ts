import { resolveDiffThemeName, type DiffThemeName } from "../lib/diffRendering";
import { usePrimarySettings } from "./useSettings";
import { useTheme } from "./useTheme";

/**
 * Resolves the diff syntax theme from the current light/dark mode and the
 * user's selected diff theme. Re-renders when either the app theme or the
 * `diffTheme` setting changes.
 */
export function useDiffThemeName(): DiffThemeName {
  const { resolvedTheme } = useTheme();
  const diffTheme = usePrimarySettings((settings) => settings.diffTheme);
  return resolveDiffThemeName(resolvedTheme, diffTheme);
}
