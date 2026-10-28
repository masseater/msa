import testing from "@msa/testing";
import tui from "@msa/tui";
import { expect, it } from "vite-plus/test";

import type messagesTypes from "../src/core/messages.types.ts";
import type InteractiveMode from "../src/modes/interactive/interactive-mode.ts";
import CustomMessagesView from "../src/modes/interactive/mode/custom-messages.ts";
import StreamingView from "../src/modes/interactive/mode/streaming.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import ansi from "../src/utils/ansi.ts";

const { initTheme, getMarkdownTheme } = themeModule;
const { stripAnsi } = ansi;
const { currentTimeMillis } = testing;

const customMessage = (content: string): messagesTypes.CustomMessage => ({
  content,
  customType: "note",
  display: true,
  role: "custom",
  timestamp: currentTimeMillis(),
});

const setup = () => {
  const chatContainer = new tui.Container();
  const mode = {
    display: {
      resources: { toolOutputExpanded: false },
      thinking: { outputPad: 1 },
    },
    footer: { invalidate: () => {} },
    input: { queue: { updatePendingMessagesDisplay: () => {} } },
    layout: { chatContainer },
    session: {
      extensions: { binding: { extensionRunner: { getMessageRenderer: () => undefined } } },
    },
    ui: { requestRender: () => {} },
    view: {} as Record<string, unknown>,
  };
  const customMessages = new CustomMessagesView(mode as unknown as InteractiveMode);
  mode.view = {
    customMessages,
    messages: {
      addMessageToChat: (message: messagesTypes.CustomMessage) =>
        customMessages.addCustomMessageToChat(message),
      getMarkdownThemeWithSettings: () => getMarkdownTheme(),
    },
  };
  const streaming = new StreamingView(mode as unknown as InteractiveMode);
  const text = () => chatContainer.render(60).map(stripAnsi).join("\n");
  return { streaming, text };
};

it("shows the replacement a message_end handler made for a custom message the chat already shows", () => {
  initTheme("dark");
  const { streaming, text } = setup();
  const shown = customMessage("original note");
  streaming.handleStreamEvent({ message: shown, type: "message_start" });
  expect(text()).toContain("original note");
  streaming.handleStreamEvent({ message: customMessage("replaced note"), type: "message_end" });
  expect(text()).toContain("replaced note");
  expect(text()).not.toContain("original note");
});
