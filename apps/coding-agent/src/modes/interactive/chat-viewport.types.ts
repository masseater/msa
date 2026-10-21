import type tuiTypes from "@msa/tui/index.types";

declare namespace chatViewportTypes {
  interface ChatViewportOptions {
    readonly document: tuiTypes.Component;
    readonly pendingMessages: tuiTypes.Component;
    readonly status: tuiTypes.Component;
    readonly editor: tuiTypes.Component;
    readonly footer: tuiTypes.Component;
    readonly widgetsAbove?: tuiTypes.Component;
    readonly widgetsBelow?: tuiTypes.Component;
    readonly scrollbar?: tuiTypes.ScrollViewScrollbar;
    readonly scrollbarTrackStyle?: (text: string) => string;
    readonly scrollbarThumbStyle?: (text: string) => string;
  }

  interface ChatViewport {
    readonly root: tuiTypes.Component;
    readonly transcript: tuiTypes.ScrollView;
  }
}

export type { chatViewportTypes as default };
