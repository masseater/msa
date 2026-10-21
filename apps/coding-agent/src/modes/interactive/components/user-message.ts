import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";
import themeModule from "../theme/theme.ts";
import markdownTransform from "./markdown-transform.ts";

const { getMarkdownTheme, theme } = themeModule;
const { createMarkdownTransform } = markdownTransform;

const { Markdown } = tui;

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

export default class UserMessageComponent extends tui.Container {
  private text: string;
  private markdownTheme: tuiTypes.MarkdownTheme;
  private outputPad: number;
  private markdownTransformers: readonly extensionsTypesTypes.MarkdownTransformer[];

  constructor(
    text: string,
    markdownTheme: tuiTypes.MarkdownTheme = getMarkdownTheme(),
    outputPad = 1,
    markdownTransformers: readonly extensionsTypesTypes.MarkdownTransformer[] = [],
  ) {
    super();
    this.text = text;
    this.markdownTheme = markdownTheme;
    this.outputPad = outputPad;
    this.markdownTransformers = markdownTransformers;
    this.rebuild();
  }

  setOutputPad(padding: number): void {
    this.outputPad = padding;
    this.rebuild();
  }

  private rebuild(): void {
    this.clear();
    this.addChild(
      new Markdown(
        this.text,
        this.outputPad,
        1,
        this.markdownTheme,
        {
          bgColor: (content: string) => theme.bg("userMessageBg", content),
          color: (content: string) => theme.fg("userMessageText", content),
        },
        {
          preserveBackslashEscapes: true,
          preserveOrderedListMarkers: true,
          transform: createMarkdownTransform("user", false, this.markdownTransformers),
        },
      ),
    );
  }

  override render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length === 0) {
      return lines;
    }

    lines[0] = OSC133_ZONE_START + lines[0];
    lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
    return lines;
  }
}
