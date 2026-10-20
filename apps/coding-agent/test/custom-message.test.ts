import testing from "@msa/testing";
import tui from "@msa/tui";
import { describe, expect, test } from "vite-plus/test";

import type extensionsTypesTypes from "../src/core/extensions/types.types.ts";
import type messagesTypes from "../src/core/messages.types.ts";
import CustomMessageComponent from "../src/modes/interactive/components/custom-message.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import ansi from "../src/utils/ansi.ts";

const { initTheme } = themeModule;
const { stripAnsi } = ansi;

const { Text } = tui;

const { currentTimeMillis } = testing;

const providesOutputPaddingToCustomRenderersAnd = () => {
  initTheme("dark");
  const optionsSeen: extensionsTypesTypes.MessageRenderOptions[] = [];
  const renderer: extensionsTypesTypes.MessageRenderer = (_message, options) => {
    optionsSeen.push(options);
    return new Text("custom", options.outputPad, 0);
  };
  const message: messagesTypes.CustomMessage = {
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
