import { type ReactNode } from "react";

import {
  RIGHT_PANEL_SHEET_CLASS_NAME,
  RIGHT_PANEL_SHEET_LAYER_CLASS_NAME,
} from "../rightPanelLayout";
import { Sheet, SheetPopup } from "./ui/sheet";

export function RightPanelSheet(props: {
  /** Defaults to 0 (no transition) for callers that do not animate the sheet. */
  animationDurationMs?: number;
  children: ReactNode;
  open: boolean;
  underFloatingPreview?: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          props.onClose();
        }
      }}
    >
      <SheetPopup
        transitionDurationMs={props.animationDurationMs ?? 0}
        side="right"
        showCloseButton={false}
        keepMounted
        {...(props.underFloatingPreview
          ? {
              backdropClassName: RIGHT_PANEL_SHEET_LAYER_CLASS_NAME,
              viewportClassName: RIGHT_PANEL_SHEET_LAYER_CLASS_NAME,
            }
          : {})}
        className={RIGHT_PANEL_SHEET_CLASS_NAME}
      >
        {props.children}
      </SheetPopup>
    </Sheet>
  );
}
