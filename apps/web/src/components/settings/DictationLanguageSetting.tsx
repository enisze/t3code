import { useEffect, useState } from "react";
import type { DesktopDictationLocale } from "@t3tools/contracts";

import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

/** Empty tag means "follow the OS language", which is the default. */
const SYSTEM_LANGUAGE = "";

interface DictationLanguageSettingProps {
  value: string;
  onChange: (tag: string) => void;
}

/**
 * Language picker for dictation, listing what the OS speech engine can
 * actually transcribe on this machine. Renders nothing where dictation is
 * unavailable, so it never offers a setting that cannot take effect.
 */
export function DictationLanguageSetting({ value, onChange }: DictationLanguageSettingProps) {
  // Absent bridge is known during render; null means "still loading".
  const [locales, setLocales] = useState<ReadonlyArray<DesktopDictationLocale> | null>(() =>
    globalThis.window?.desktopBridge?.listDictationLocales ? null : [],
  );

  useEffect(() => {
    const list = globalThis.window?.desktopBridge?.listDictationLocales;
    if (!list) return;
    let cancelled = false;
    void list()
      .then((result) => {
        if (!cancelled) setLocales(result.ok ? result.locales : []);
      })
      .catch(() => {
        if (!cancelled) setLocales([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (locales !== null && locales.length === 0) return null;

  const selected = locales?.find((locale) => locale.tag === value);
  const label =
    value === SYSTEM_LANGUAGE
      ? "System language"
      : (selected?.label ?? (value || "System language"));

  return (
    <Select value={value} onValueChange={(next) => onChange(next ?? SYSTEM_LANGUAGE)}>
      <SelectTrigger
        className="w-full sm:w-56"
        aria-label="Dictation language"
        disabled={locales === null}
      >
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        <SelectItem hideIndicator value={SYSTEM_LANGUAGE}>
          System language
        </SelectItem>
        {(locales ?? []).map((locale) => (
          <SelectItem hideIndicator key={locale.tag} value={locale.tag}>
            {locale.installed ? locale.label : `${locale.label} (downloads on first use)`}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
