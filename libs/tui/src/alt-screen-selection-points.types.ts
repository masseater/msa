import type scrollViewTypes from "./components/scroll-view.types.ts";

declare namespace altScreenSelectionPointsTypes {
  interface PointerTarget {
    x: number;
    y: number;
    scrollView?: scrollViewTypes.ScrollView | undefined;
  }

  interface ScrollPointerTarget {
    x: number;
    y: number;
    scrollView: scrollViewTypes.ScrollView;
  }
}

export type { altScreenSelectionPointsTypes as default };
