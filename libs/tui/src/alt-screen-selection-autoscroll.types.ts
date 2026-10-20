import type SelectionAutoScrollClass from "./alt-screen-selection-autoscroll.ts";
import type altScreenSelectionTextTypes from "./alt-screen-selection-text.types.ts";
import type altScreenViewTypes from "./alt-screen-view.ts";
import type scrollViewTypes from "./components/scroll-view.types.ts";

declare namespace altScreenSelectionAutoscrollTypes {
  interface AutoScrollHost {
    readonly view: altScreenViewTypes.AltScreenView;
    anchorScrollView(): scrollViewTypes.ScrollView | undefined;
    onScroll(point: altScreenSelectionTextTypes.SelectionPoint | undefined): void;
  }

  type SelectionAutoScroll = SelectionAutoScrollClass;
}

export type { altScreenSelectionAutoscrollTypes as default };
