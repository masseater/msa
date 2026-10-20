import tui from "@msa/tui";

import type chatViewportTypes from "./chat-viewport.types.ts";

const { ScrollView, VStack } = tui;

function createChatViewport(
  options: chatViewportTypes.ChatViewportOptions,
): chatViewportTypes.ChatViewport {
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
      { basis: 0, component: transcript, grow: 1, minSize: 1, shrink: 1 },
      { basis: "auto", component: dock, grow: 0, minSize: 1, shrink: 1 },
    ]),
    transcript,
  };
}

const chatViewport = {
  createChatViewport,
};

export default chatViewport;
