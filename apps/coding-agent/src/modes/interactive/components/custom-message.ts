import type aiTypes from "@msa/ai/index.types";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";
import type messagesTypes from "../../../core/messages.types.ts";
import themeModule from "../theme/theme.ts";

const { getMarkdownTheme, theme } = themeModule;

const { Box, Markdown, Spacer, Text } = tui;

export default class CustomMessageComponent extends tui.Container {
  private message: messagesTypes.CustomMessage<unknown>;
  private customRenderer?: extensionsTypesTypes.MessageRenderer | undefined;
  private box: tuiTypes.Box;
  private customComponent?: tuiTypes.Component | undefined;
  private markdownTheme: tuiTypes.MarkdownTheme;
  private expandedState = false;
  private outputPad: number;

  constructor(
    message: messagesTypes.CustomMessage<unknown>,
    customRenderer?: extensionsTypesTypes.MessageRenderer,
    markdownTheme: tuiTypes.MarkdownTheme = getMarkdownTheme(),
    outputPad = 1,
  ) {
    super();
    this.message = message;
    this.customRenderer = customRenderer;
    this.markdownTheme = markdownTheme;
    this.outputPad = outputPad;

    this.addChild(new Spacer(1));

    this.box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));

    this.rebuild();
  }

  setMessage(message: messagesTypes.CustomMessage<unknown>): void {
    this.message = message;
    this.rebuild();
  }

  setExpanded(expanded: boolean): void {
    if (this.expandedState !== expanded) {
      this.expandedState = expanded;
      this.rebuild();
    }
  }

  setOutputPad(outputPad: number): void {
    if (this.outputPad !== outputPad) {
      this.outputPad = outputPad;
      this.rebuild();
    }
  }

  override invalidate(): void {
    super.invalidate();
    this.rebuild();
  }

  private rebuild(): void {
    if (this.customComponent !== undefined) {
      this.removeChild(this.customComponent);
      this.customComponent = undefined;
    }
    this.removeChild(this.box);

    if (this.customRenderer !== undefined) {
      try {
        const component = this.customRenderer(
          this.message,
          { expanded: this.expandedState, outputPad: this.outputPad },
          theme,
        );
        if (component !== undefined) {
          this.customComponent = component;
          this.addChild(component);
          return;
        }
      } catch {}
    }

    this.addChild(this.box);
    this.box.clear();
    this.box.setPaddingX(this.outputPad);

    const label = theme.fg("customMessageLabel", `\x1b[1m[${this.message.customType}]\x1b[22m`);
    this.box.addChild(new Text(label, 0, 0));
    this.box.addChild(new Spacer(1));

    let text: string;
    if (typeof this.message.content === "string") {
      text = this.message.content;
    } else {
      text = this.message.content
        .filter((c): c is aiTypes.TextContent => c.type === "text")
        .map((c) => c.text)
        .join("\n");
    }

    this.box.addChild(
      new Markdown(text, 0, 0, this.markdownTheme, {
        color: (value: string) => theme.fg("customMessageText", value),
      }),
    );
  }
}
