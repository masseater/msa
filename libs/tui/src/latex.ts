import { dual } from "effect/Function";

import { type LayoutNode, PROTECTED_SPACE, renderLayout } from "./latex-layout.ts";
import { LatexParser } from "./latex-parser.ts";

export interface RenderLatexOptions {
  display?: boolean;
}

export const renderLatex: {
  (source: string, options?: RenderLatexOptions): string | undefined;
  (options?: RenderLatexOptions): (source: string) => string | undefined;
} = dual(
  (args) => typeof args[0] === "string",
  (source: string, options: RenderLatexOptions = {}): string | undefined => {
    const layoutNodes: LayoutNode[] = [];
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
