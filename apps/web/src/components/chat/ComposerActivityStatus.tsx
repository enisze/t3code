import { TriangleAlertIcon } from "lucide-react";

import { Spinner } from "~/components/ui/spinner";

import { isThreadSyncFailure, threadSyncLabel, type ThreadSyncPhase } from "../../threadSync";
import { ComposerBanner } from "./ComposerBanner";

export function ComposerActivityRow({ phase }: { readonly phase: ThreadSyncPhase }) {
  return (
    <ComposerBanner.Row>
      <ComposerBanner.Icon>
        {isThreadSyncFailure(phase) ? (
          <TriangleAlertIcon aria-hidden className="size-3.5 text-destructive" />
        ) : (
          <Spinner />
        )}
      </ComposerBanner.Icon>
      <ComposerBanner.Content>
        <span
          className="shrink-0 whitespace-nowrap text-muted-foreground"
          data-composer-sync-status={phase}
          role="status"
        >
          {threadSyncLabel(phase)}
        </span>
      </ComposerBanner.Content>
    </ComposerBanner.Row>
  );
}
