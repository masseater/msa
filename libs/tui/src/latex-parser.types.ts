import type LatexParserClass from "./latex-parser.ts";

declare namespace latexParserTypes {
  type LatexParser = LatexParserClass;
}

export type { latexParserTypes as default };
