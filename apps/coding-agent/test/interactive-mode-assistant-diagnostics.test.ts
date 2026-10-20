import type aiTypes from "@msa/ai/index.types";
import tui from "@msa/tui";
import { describe, expect, test } from "vite-plus/test";

import themeModule from "../src/modes/interactive/theme/theme.ts";
import ansi from "../src/utils/ansi.ts";
import interactiveModeFake from "./interactive-mode-fake.ts";

const { bindModeFake } = interactiveModeFake;
const { initTheme } = themeModule;
const { stripAnsi } = ansi;

const { Container } = tui;

const message: aiTypes.AssistantMessage = {
  api: "anthropic-messages",
  content: [{ text: "survived", type: "text" }],
  diagnostics: [
    {
      details: {
        transformations: [
          {
            path: "messages.2.content.0",
            reason: "prefix_binding_mismatch",
            type: "thinking_dropped",
          },
          {
            path: "messages.5.content.0",
            reason: "prefix_binding_mismatch",
            type: "thinking_dropped",
          },
          {
            path: "messages.8.content.0",
            reason: "prefix_binding_mismatch",
            type: "thinking_dropped",
          },
        ],
      },
      timestamp: 1,
      type: "anthropic_input_transformations",
    },
  ],
  model: "claude-fable-5-1",
  provider: "anthropic-api",
  role: "assistant",
  stopReason: "stop",
  timestamp: 1,
  usage: {
    cacheRead: 0,
    cacheWrite: 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input: 1,
    output: 1,
    totalTokens: 2,
  },
};
const showsAnthropicThinkingDropsWhenCacheMiss = () => {
  initTheme("dark");
  const enabled = {
    chatContainer: new Container(),
    sessionManager: { getBranch: () => [] },
    settingsManager: { display: { getShowCacheMissNotices: () => true } },
  };
  bindModeFake(enabled).display.notices.usage.maybeShowThinkingDropNotice(message);
  const output = stripAnsi(enabled.chatContainer.render(120).join("\n"));
  expect(output).toContain("Anthropic dropped 3 thinking blocks (details in session)");

  const disabled = {
    chatContainer: new Container(),
    sessionManager: { getBranch: () => [] },
    settingsManager: { display: { getShowCacheMissNotices: () => false } },
  };
  bindModeFake(disabled).display.notices.usage.maybeShowThinkingDropNotice(message);
  expect(disabled.chatContainer.children).toHaveLength(0);
};

const doesNotRepeatUnchangedAnthropicThinkingDrops = () => {
  initTheme("dark");
  const context = {
    chatContainer: new Container(),
    sessionManager: { getBranch: () => [{ message, type: "message" as const }] },
    settingsManager: { display: { getShowCacheMissNotices: () => true } },
  };

  bindModeFake(context).display.notices.usage.maybeShowThinkingDropNotice({
    ...message,
    timestamp: 2,
  });

  expect(context.chatContainer.children).toHaveLength(0);
};

describe("InteractiveMode assistant diagnostics", () => {
  test(
    "shows Anthropic thinking drops when cache miss notices are enabled",
    showsAnthropicThinkingDropsWhenCacheMiss,
  );

  test(
    "does not repeat unchanged Anthropic thinking drops",
    doesNotRepeatUnchangedAnthropicThinkingDrops,
  );
});
