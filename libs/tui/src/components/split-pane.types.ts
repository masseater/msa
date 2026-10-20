import type tuiComponentTypes from "../tui-component.types.ts";
import type splitPane from "./split-pane.ts";

declare namespace splitPaneTypes {
  interface SplitPaneOptions {
    left: tuiComponentTypes.Component;
    right: tuiComponentTypes.Component;
    divider: tuiComponentTypes.Component;
    rightShare: () => number;
    minRightWidth: number;
    minLeftWidth?: number;
    visible?: () => boolean;
  }

  interface SplitPaneWidths {
    left: number;
    divider: number;
    right: number;
  }

  type SplitPane = (typeof splitPane.SplitPane)["prototype"];
}

export type { splitPaneTypes as default };
