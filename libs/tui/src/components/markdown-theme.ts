declare namespace markdownThemeTypes {
  interface DefaultTextStyle {
    color?: (text: string) => string;
    bgColor?: (text: string) => string;
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    underline?: boolean;
  }

  interface MarkdownTheme {
    heading: (text: string) => string;
    link: (text: string) => string;
    linkUrl: (text: string) => string;
    code: (text: string) => string;
    codeBlock: (text: string) => string;
    codeBlockBorder: (text: string) => string;
    quote: (text: string) => string;
    quoteBorder: (text: string) => string;
    hr: (text: string) => string;
    listBullet: (text: string) => string;
    bold: (text: string) => string;
    italic: (text: string) => string;
    strikethrough: (text: string) => string;
    underline: (text: string) => string;
    highlightCode?: (code: string, lang?: string) => string[];
    codeBlockIndent?: string;
  }

  interface MarkdownOptions {
    preserveOrderedListMarkers?: boolean;
    preserveBackslashEscapes?: boolean;
    transform?: (markdown: string, availableWidth: number) => string;
    renderLatex?: boolean;
  }

  interface InlineStyleContext {
    applyText: (text: string) => string;
    stylePrefix: string;
  }
}

export type { markdownThemeTypes as default };
