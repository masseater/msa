import type markdownTypes from "../src/components/markdown.types.ts";

declare namespace markdownTerminalHelpersTypes {
  interface MarkdownTerminalRequest {
    readonly source: string;
    readonly theme: markdownTypes.MarkdownTheme;
    readonly width: number;
    readonly height: number;
  }
}

export type { markdownTerminalHelpersTypes as default };
