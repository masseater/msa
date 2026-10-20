import type tuiTypes from "@msa/tui/index.types";

import type FocusPanelClass from "./focus-panel.ts";

declare namespace focusPanelTypes {
  type FocusPanelColor = "error" | "success" | "accent";

  type FocusPanelConfig = {
    label: string;
    color: FocusPanelColor;
    options: tuiTypes.OverlayOptions;
  };

  type FocusPanelEntry = { panel: FocusPanel; handle: tuiTypes.OverlayHandle };

  type FocusPanel = (typeof FocusPanelClass)["prototype"];
}

export type { focusPanelTypes as default };
