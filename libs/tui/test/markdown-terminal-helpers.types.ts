import type { MarkdownTheme } from "../src/components/markdown.ts";

declare namespace markdownTerminalHelpersTypes {
  interface MarkdownTerminalRequest {
    readonly source: string;
    readonly theme: MarkdownTheme;
    readonly width: number;
    readonly height: number;
  }
}

export type { markdownTerminalHelpersTypes as default };
