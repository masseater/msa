import { dual } from "effect/Function";

import latexLayout from "./latex-layout.ts";
import type latexLayoutTypes from "./latex-layout.types.ts";
import LatexParser from "./latex-parser.ts";
import type latexTypes from "./latex.types.ts";

const { PROTECTED_SPACE, renderLayout } = latexLayout;

const renderLatex: {
  (source: string, options?: latexTypes.RenderLatexOptions): string | undefined;
  (options?: latexTypes.RenderLatexOptions): (source: string) => string | undefined;
} = dual(
  (args) => typeof args[0] === "string",
  (source: string, options: latexTypes.RenderLatexOptions = {}): string | undefined => {
    const layoutNodes: latexLayoutTypes.LayoutNode[] = [];
    const rendered = new LatexParser(source, layoutNodes, options.display === true).render();
    if (rendered === undefined) {
      return undefined;
    }
    if (layoutNodes.length === 0) {
      return rendered.replaceAll(PROTECTED_SPACE, " ");
    }
    const lines = renderLayout(rendered, layoutNodes).lines;
    const indentation = Math.min(
      ...lines.filter((line) => line.trim()).map((line) => line.length - line.trimStart().length),
    );
    return lines
      .map((line) => line.slice(indentation).trimEnd())
      .join("\n")
      .trimEnd()
      .replaceAll(PROTECTED_SPACE, " ");
  },
);

const latex = {
  renderLatex,
};

export default latex;
