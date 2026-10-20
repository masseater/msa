import type ScrollViewClass from "./scroll-view.ts";

declare namespace scrollViewTypes {
  type ScrollViewScrollbar = "hidden" | "auto" | "always";

  interface ScrollViewOptions {
    axis?: "vertical";
    follow?: "none" | "end";
    primary?: boolean;
    overscroll?: "chain" | "contain";
    scrollbar?: ScrollViewScrollbar;
    scrollbarTrackStyle?: (text: string) => string;
    scrollbarThumbStyle?: (text: string) => string;
    scrollbarHideDelayMs?: number;
  }

  interface ScrollViewScrollToOptions {
    disableFollow?: boolean;
  }

  type ScrollView = ScrollViewClass;
}

export type { scrollViewTypes as default };
