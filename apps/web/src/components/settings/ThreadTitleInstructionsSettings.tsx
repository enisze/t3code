import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";

import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { Textarea } from "../ui/textarea";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function ThreadTitleInstructionsSettings() {
  const threadTitleInstructions = usePrimarySettings(
    (settings) => settings.threadTitleInstructions,
  );
  const updateSettings = useUpdatePrimarySettings();

  return (
    <SettingsRow
      serverScoped
      {...searchableSetting("thread-title-instructions")}
      description="Added to the prompt for new and regenerated thread titles."
      resetAction={
        threadTitleInstructions !== DEFAULT_UNIFIED_SETTINGS.threadTitleInstructions ? (
          <SettingResetButton
            label="thread title instructions"
            onClick={() =>
              updateSettings({
                threadTitleInstructions: DEFAULT_UNIFIED_SETTINGS.threadTitleInstructions,
              })
            }
          />
        ) : null
      }
    >
      <div className="mt-3 max-w-2xl pb-3.5">
        <Textarea
          key={threadTitleInstructions}
          defaultValue={threadTitleInstructions}
          onBlur={(event) => {
            const next = event.target.value.trim();
            if (next !== threadTitleInstructions) {
              updateSettings({ threadTitleInstructions: next });
            }
          }}
          rows={4}
          placeholder="Keep titles to a few words. Write them in German."
          aria-label="Thread title instructions"
        />
      </div>
    </SettingsRow>
  );
}
