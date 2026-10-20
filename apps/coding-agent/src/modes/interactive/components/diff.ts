import * as Diff from "diff";
import { dual } from "effect/Function";

import themeModule from "../theme/theme.ts";
import type diffTypes from "./diff.types.ts";

const { theme } = themeModule;

function parseDiffLine(line: string): { prefix: string; lineNum: string; content: string } | null {
  const match = line.match(/^([+\-\s])(\s*\d*)\s(.*)$/u);
  if (match === null) return null;
  const [, prefix, lineNum, content] = match;
  if (prefix === undefined || lineNum === undefined || content === undefined) return null;
  return { content, lineNum, prefix };
}

function replaceTabs(text: string): string {
  return text.replace(/\t/gu, "   ");
}

function renderIntraLineDiff(
  oldContent: string,
  newContent: string,
): { removedLine: string; addedLine: string } {
  const wordDiff = Diff.diffWords(oldContent, newContent);

  let removedLine = "";
  let addedLine = "";
  let isFirstRemoved = true;
  let isFirstAdded = true;

  for (const part of wordDiff) {
    if (part.removed) {
      let value = part.value;
      if (isFirstRemoved) {
        const leadingWs = value.match(/^(\s*)/u)?.[1] || "";
        value = value.slice(leadingWs.length);
        removedLine += leadingWs;
        isFirstRemoved = false;
      }
      if (value !== "") {
        removedLine += theme.inverse(value);
      }
    } else if (part.added) {
      let value = part.value;
      if (isFirstAdded) {
        const leadingWs = value.match(/^(\s*)/u)?.[1] || "";
        value = value.slice(leadingWs.length);
        addedLine += leadingWs;
        isFirstAdded = false;
      }
      if (value !== "") {
        addedLine += theme.inverse(value);
      }
    } else {
      removedLine += part.value;
      addedLine += part.value;
    }
  }

  return { addedLine, removedLine };
}

const renderDiff: {
  (_options?: diffTypes.RenderDiffOptions): (diffText: string) => string;
  (diffText: string, _options?: diffTypes.RenderDiffOptions): string;
} = dual(
  (args) => typeof args[0] === "string",
  (diffText: string, _options: diffTypes.RenderDiffOptions = {}): string => {
    const lines = diffText.split("\n");
    const result: string[] = [];

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line === undefined) break;
      const parsed = parseDiffLine(line);

      if (parsed === null) {
        result.push(theme.fg("toolDiffContext", line));
        i++;
        continue;
      }

      if (parsed.prefix === "-") {
        const removedLines: { lineNum: string; content: string }[] = [];
        i = renderDiffPart1(i, lines, removedLines);

        const addedLines: { lineNum: string; content: string }[] = [];
        while (i < lines.length) {
          const next = lines[i];
          if (next === undefined) break;
          const p = parseDiffLine(next);
          if (p === null || p.prefix !== "+") break;
          addedLines.push({ content: p.content, lineNum: p.lineNum });
          i++;
        }

        const [onlyRemoved] = removedLines;
        const [onlyAdded] = addedLines;
        buildPart1(removedLines, addedLines, onlyRemoved, onlyAdded, result);
      } else if (parsed.prefix === "+") {
        result.push(theme.fg("toolDiffAdded", `+${parsed.lineNum} ${replaceTabs(parsed.content)}`));
        i++;
      } else {
        result.push(
          theme.fg("toolDiffContext", ` ${parsed.lineNum} ${replaceTabs(parsed.content)}`),
        );
        i++;
      }
    }

    return result.join("\n");
  },
);

function renderDiffPart1(
  i: number,
  lines: string[],
  removedLines: { lineNum: string; content: string }[],
) {
  while (i < lines.length) {
    const next = lines[i];
    if (next === undefined) break;
    const p = parseDiffLine(next);
    if (p === null || p.prefix !== "-") break;
    removedLines.push({ content: p.content, lineNum: p.lineNum });
    i++;
  }
  return i;
}

function buildPart1(
  removedLines: { lineNum: string; content: string }[],
  addedLines: { lineNum: string; content: string }[],
  onlyRemoved: { lineNum: string; content: string } | undefined,
  onlyAdded: { lineNum: string; content: string } | undefined,
  result: string[],
): void {
  if (
    removedLines.length === 1 &&
    addedLines.length === 1 &&
    onlyRemoved !== undefined &&
    onlyAdded !== undefined
  ) {
    const { removedLine, addedLine } = renderIntraLineDiff(
      replaceTabs(onlyRemoved.content),
      replaceTabs(onlyAdded.content),
    );

    result.push(theme.fg("toolDiffRemoved", `-${onlyRemoved.lineNum} ${removedLine}`));
    result.push(theme.fg("toolDiffAdded", `+${onlyAdded.lineNum} ${addedLine}`));
  } else {
    for (const removed of removedLines) {
      result.push(
        theme.fg("toolDiffRemoved", `-${removed.lineNum} ${replaceTabs(removed.content)}`),
      );
    }
    for (const added of addedLines) {
      result.push(theme.fg("toolDiffAdded", `+${added.lineNum} ${replaceTabs(added.content)}`));
    }
  }
}

const diff = {
  renderDiff,
};

export default diff;
