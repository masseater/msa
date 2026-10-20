import { Container } from "@msa/tui";
import { describe, expect, test } from "vite-plus/test";

import { createChatViewport } from "../src/modes/interactive/chat-viewport.ts";

const defaultsTheTranscriptScrollbarToAutoAnd = () => {
  const automatic = createChatViewport({
    document: new Container(),
    editor: new Container(),
    footer: new Container(),
    pendingMessages: new Container(),
    status: new Container(),
  });
  const hidden = createChatViewport({
    document: new Container(),
    editor: new Container(),
    footer: new Container(),
    pendingMessages: new Container(),
    scrollbar: "hidden",
    status: new Container(),
  });

  expect(automatic.transcript.scrollbar).toBe("auto");
  expect(hidden.transcript.scrollbar).toBe("hidden");
};

describe("chat viewport", () => {
  test(
    "defaults the transcript scrollbar to auto and accepts overrides",
    defaultsTheTranscriptScrollbarToAutoAnd,
  );
});
