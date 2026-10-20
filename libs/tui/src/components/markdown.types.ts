import type markdownThemeTypes from "./markdown-theme.ts";
import type MarkdownClass from "./markdown.ts";

declare namespace markdownTypes {
  type DefaultTextStyle = markdownThemeTypes.DefaultTextStyle;

  type MarkdownOptions = markdownThemeTypes.MarkdownOptions;

  type MarkdownTheme = markdownThemeTypes.MarkdownTheme;

  type Markdown = MarkdownClass;
}

export type { markdownTypes as default };
