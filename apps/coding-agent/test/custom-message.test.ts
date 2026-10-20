import testing from "@msa/testing";
import { Text } from "@msa/tui";
import { describe, expect, test } from "vite-plus/test";

import type { MessageRenderOptions, MessageRenderer } from "../src/core/extensions/types.ts";
import type { CustomMessage } from "../src/core/messages.ts";
import { CustomMessageComponent } from "../src/modes/interactive/components/custom-message.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const { currentTimeMillis } = testing;

const providesOutputPaddingToCustomRenderersAnd = () => {
  initTheme("dark");
  const optionsSeen: MessageRenderOptions[] = [];
  const renderer: MessageRenderer = (_message, options) => {
    optionsSeen.push(options);
    return new Text("custom", options.outputPad, 0);
  };
  const message: CustomMessage = {
    content: "custom",
    customType: "test",
    display: true,
    role: "custom",
    timestamp: currentTimeMillis(),
  };
  const component = new CustomMessageComponent(message, renderer, undefined, 1);

  expect(optionsSeen).toEqual([{ expanded: false, outputPad: 1 }]);
  expect(
    component
      .render(40)
      .map(stripAnsi)
      .some((line) => line.startsWith(" custom")),
  ).toBe(true);

  component.setOutputPad(0);

  expect(optionsSeen.at(-1)).toEqual({ expanded: false, outputPad: 0 });
  expect(
    component
      .render(40)
      .map(stripAnsi)
      .some((line) => line.startsWith("custom")),
  ).toBe(true);
};

describe("CustomMessageComponent", () => {
  test(
    "provides output padding to custom renderers and updates it",
    providesOutputPaddingToCustomRenderersAnd,
  );
});
