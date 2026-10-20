import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

const { ScrollView, VStack } = tui;

export interface ChatViewportOptions {
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

export interface ChatViewport {
  readonly root: tuiTypes.Component;
  readonly transcript: tuiTypes.ScrollView;
}

export function createChatViewport(options: ChatViewportOptions): ChatViewport {
  const transcript = new ScrollView(options.document, {
    follow: "end",
    overscroll: "chain",
    primary: true,
    scrollbar: options.scrollbar ?? "auto",
    ...(options.scrollbarTrackStyle === undefined
      ? {}
      : { scrollbarTrackStyle: options.scrollbarTrackStyle }),
    ...(options.scrollbarThumbStyle === undefined
      ? {}
      : { scrollbarThumbStyle: options.scrollbarThumbStyle }),
  });
  const dock = new VStack([
    { component: options.pendingMessages, minSize: 0, shrink: 1 },
    { component: options.status, minSize: 0, shrink: 1 },
    ...(options.widgetsAbove === undefined
      ? []
      : [{ component: options.widgetsAbove, minSize: 0, shrink: 1 }]),
    { component: options.editor, minSize: 3, shrink: 1 },
    ...(options.widgetsBelow === undefined
      ? []
      : [{ component: options.widgetsBelow, minSize: 0, shrink: 1 }]),
    { component: options.footer, minSize: 0, shrink: 1 },
  ]);
  return {
    root: new VStack([
      { component: transcript, basis: 0, grow: 1, shrink: 1, minSize: 1 },
      { component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 1 },
    ]),
    transcript,
  };
}
