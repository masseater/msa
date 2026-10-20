import type { Tokens } from "marked";

declare namespace markdownTokenizerTypes {
  interface LatexToken extends Tokens.Generic {
    type: "latex" | "latexBlock";
    text: string;
    pending?: boolean;
  }
}

export type { markdownTokenizerTypes as default };
