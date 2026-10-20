import { dual } from "effect/Function";

import type latexLayoutTypes from "./latex-layout.types.ts";
import utils from "./utils.ts";

const { visibleWidth } = utils;

interface Layout {
  lines: string[];
  width: number;
  baseline: number;
}

const LAYOUT_MARKER_START = "\u{f0000}";
const LAYOUT_MARKER_END = "\u{f0001}";
const LAYOUT_MARKER_PATTERN = /\u{f0000}(\d+)\u{f0001}/gu;
const TRAILING_LAYOUT_MARKER_PATTERN = /\u{f0000}(\d+)\u{f0001}$/u;
const PROTECTED_SPACE = "\u{f0002}";

function layoutMarker(index: number): string {
  return `${LAYOUT_MARKER_START}${index}${LAYOUT_MARKER_END}`;
}

function padLayoutLine(line: string, width: number, centered = false): string {
  const padding = Math.max(0, width - visibleWidth(line));
  const left = centered ? Math.floor(padding / 2) : 0;
  return `${" ".repeat(left)}${line}${" ".repeat(padding - left)}`;
}

function textLayout(text: string): Layout {
  return { baseline: 0, lines: [text], width: visibleWidth(text) };
}

function joinLayouts(layouts: readonly Layout[]): Layout {
  if (layouts.length === 0) {
    return { baseline: 0, lines: [""], width: 0 };
  }
  const baseline = Math.max(...layouts.map((layout) => layout.baseline));
  const below = Math.max(...layouts.map((layout) => layout.lines.length - layout.baseline - 1));
  const lines: string[] = [];
  for (let row = 0; row <= baseline + below; row++) {
    let line = "";
    for (const layout of layouts) {
      const sourceRow = row - baseline + layout.baseline;
      line +=
        sourceRow >= 0 && sourceRow < layout.lines.length
          ? padLayoutLine(layout.lines[sourceRow] ?? "", layout.width)
          : " ".repeat(layout.width);
    }
    lines.push(line.trimEnd());
  }
  return {
    baseline,
    lines,
    width: layouts.reduce((width, layout) => width + layout.width, 0),
  };
}

function fractionLayout(
  node: latexLayoutTypes.FractionNode,
  nodes: readonly latexLayoutTypes.LayoutNode[],
): Layout {
  const numerator = renderLayout(node.numerator, nodes);
  const denominator = renderLayout(node.denominator, nodes);
  const contentWidth = Math.max(numerator.width, denominator.width, 1);
  const width = contentWidth + 2;
  return {
    baseline: numerator.lines.length,
    lines: [
      ...numerator.lines.map((line) => padLayoutLine(line, width, true)),
      ` ${"─".repeat(contentWidth)} `,
      ...denominator.lines.map((line) => padLayoutLine(line, width, true)),
    ],
    width,
  };
}

function operatorLayout(node: latexLayoutTypes.OperatorNode): Layout {
  const contentWidth = Math.max(
    visibleWidth(node.operator),
    node.lower === undefined ? 0 : visibleWidth(node.lower),
    node.upper === undefined ? 0 : visibleWidth(node.upper),
  );
  const rows = [node.upper, node.operator, node.lower].filter(
    (row): row is string => row !== undefined,
  );
  return {
    baseline: node.upper === undefined ? 0 : 1,
    lines: rows.map((row) => `${padLayoutLine(row, contentWidth, true)} `),
    width: contentWidth + 1,
  };
}

function scriptLayout(
  node: latexLayoutTypes.ScriptNode,
  nodes: readonly latexLayoutTypes.LayoutNode[],
): Layout {
  const upper = node.upper === undefined ? undefined : renderLayout(node.upper, nodes);
  const lower = node.lower === undefined ? undefined : renderLayout(node.lower, nodes);
  const width = Math.max(upper?.width ?? 0, lower?.width ?? 0);
  return {
    baseline: upper?.lines.length ?? 0,
    lines: [
      ...(upper?.lines.map((line) => padLayoutLine(line, width)) ?? []),
      " ".repeat(width),
      ...(lower?.lines.map((line) => padLayoutLine(line, width)) ?? []),
    ],
    width,
  };
}

function nodeLayout(
  node: latexLayoutTypes.LayoutNode,
  nodes: readonly latexLayoutTypes.LayoutNode[],
): Layout {
  if (node.type === "fraction") return fractionLayout(node, nodes);
  if (node.type === "operator") return operatorLayout(node);
  if (node.type === "script") return scriptLayout(node, nodes);
  const width = Math.max(0, ...node.lines.map((line) => visibleWidth(line)));
  return {
    baseline: node.baseline,
    lines: node.lines.map((line) => padLayoutLine(line, width)),
    width,
  };
}

function textBetweenNodes(
  sliced: string,
  previousNode: latexLayoutTypes.LayoutNode | undefined,
  node: latexLayoutTypes.LayoutNode,
): string {
  const trimmed = (previousNode === undefined ? sliced : sliced.trimStart()).trimEnd();
  const preserveLeadingSpace = previousNode?.type === "matrix" && /^\s/u.test(sliced);
  const preserveTrailingSpace = node.type === "matrix" && /\s$/u.test(sliced);
  if (trimmed === "") {
    return preserveLeadingSpace || preserveTrailingSpace ? " " : "";
  }
  return `${preserveLeadingSpace ? " " : ""}${trimmed}${preserveTrailingSpace ? " " : ""}`;
}

function trailingText(
  sliced: string,
  previousNode: latexLayoutTypes.LayoutNode | undefined,
): string {
  const trimmed = previousNode === undefined ? sliced : sliced.trimStart();
  return previousNode?.type === "matrix" && /^\s/u.test(sliced) ? ` ${trimmed}` : trimmed;
}

function renderLayoutLine(
  sourceLine: string,
  nodes: readonly latexLayoutTypes.LayoutNode[],
): Layout {
  const layouts: Layout[] = [];
  let position = 0;
  let previousNode: latexLayoutTypes.LayoutNode | undefined;
  for (const match of sourceLine.matchAll(LAYOUT_MARKER_PATTERN)) {
    const index = match.index;
    const node = nodes[Number(match[1])];
    if (node === undefined) {
      continue;
    }
    if (index > position) {
      layouts.push(
        textLayout(textBetweenNodes(sourceLine.slice(position, index), previousNode, node)),
      );
    }
    layouts.push(nodeLayout(node, nodes));
    position = index + match[0].length;
    previousNode = node;
  }
  if (position < sourceLine.length) {
    layouts.push(textLayout(trailingText(sourceLine.slice(position), previousNode)));
  }
  return joinLayouts(layouts);
}

const renderLayout: {
  (source: string, nodes: readonly latexLayoutTypes.LayoutNode[]): Layout;
  (nodes: readonly latexLayoutTypes.LayoutNode[]): (source: string) => Layout;
} = dual(2, (source: string, nodes: readonly latexLayoutTypes.LayoutNode[]): Layout => {
  const renderedLines: string[] = [];
  let firstBaseline = 0;
  for (const sourceLine of source.split("\n")) {
    const lineLayout = renderLayoutLine(sourceLine, nodes);
    if (renderedLines.length === 0) {
      firstBaseline = lineLayout.baseline;
    }
    renderedLines.push(...lineLayout.lines);
  }
  return {
    baseline: firstBaseline,
    lines: renderedLines,
    width: Math.max(0, ...renderedLines.map((line) => visibleWidth(line))),
  };
});

const latexLayout = {
  LAYOUT_MARKER_START,
  PROTECTED_SPACE,
  TRAILING_LAYOUT_MARKER_PATTERN,
  layoutMarker,
  renderLayout,
};

export default latexLayout;
