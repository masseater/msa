import type ScrollToEndIndicatorClass from "./alt-screen-end-indicator.ts";
import type scrollViewTypes from "./components/scroll-view.types.ts";
import type layoutTypes from "./layout.types.ts";

declare namespace altScreenEndIndicatorTypes {
  interface IndicatorFrame {
    layout: layoutTypes.LayoutFrame;
    scrollView: scrollViewTypes.ScrollView;
    width: number;
  }

  type ScrollToEndIndicator = ScrollToEndIndicatorClass;
}

export type { altScreenEndIndicatorTypes as default };
