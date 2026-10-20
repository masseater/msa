import type editReplacementsTypes from "./edit-replacements.types.ts";
import editText from "./edit-text.ts";

const { splitLinesWithEndings } = editText;

interface LineSpan {
  start: number;
  end: number;
}

const OUTSIDE_BASE = "Replacement range is outside the base content.";

function getLineSpans(content: string): LineSpan[] {
  let offset = 0;
  return splitLinesWithEndings(content).map((line) => {
    const span = { end: offset + line.length, start: offset };
    offset = span.end;
    return span;
  });
}

function getReplacementLineRange(
  lines: LineSpan[],
  replacement: editReplacementsTypes.TextReplacement,
) {
  const replacementStart = replacement.matchIndex;
  const replacementEnd = replacement.matchIndex + replacement.matchLength;
  const startLine = lines.findIndex(
    (line) => replacementStart >= line.start && replacementStart < line.end,
  );
  if (startLine === -1) throw new Error(OUTSIDE_BASE);

  let endLine = startLine;
  for (;;) {
    const line = lines[endLine];
    if (line === undefined) throw new Error(OUTSIDE_BASE);
    if (line.end >= replacementEnd) break;
    endLine++;
  }
  return { endLine: endLine + 1, startLine };
}

function applyReplacements({
  content,
  replacements,
  offset = 0,
}: editReplacementsTypes.ApplyReplacementsInput): string {
  let result = content;
  for (const replacement of replacements.toReversed()) {
    const matchIndex = replacement.matchIndex - offset;
    result =
      result.substring(0, matchIndex) +
      replacement.newText +
      result.substring(matchIndex + replacement.matchLength);
  }
  return result;
}

interface ReplacementGroup {
  startLine: number;
  endLine: number;
  replacements: editReplacementsTypes.TextReplacement[];
}

function groupReplacements(
  baseLines: LineSpan[],
  replacements: editReplacementsTypes.TextReplacement[],
) {
  const groups: ReplacementGroup[] = [];
  const sorted = [...replacements].sort((a, b) => a.matchIndex - b.matchIndex);
  for (const replacement of sorted) {
    const range = getReplacementLineRange(baseLines, replacement);
    const current = groups.at(-1);
    if (current !== undefined && range.startLine < current.endLine) {
      current.endLine = Math.max(current.endLine, range.endLine);
      current.replacements.push(replacement);
    } else {
      groups.push({ ...range, replacements: [replacement] });
    }
  }
  return groups;
}

function applyReplacementsPreservingUnchangedLines({
  originalContent,
  baseContent,
  replacements,
}: editReplacementsTypes.PreserveUnchangedInput): string {
  const originalLines = splitLinesWithEndings(originalContent);
  const baseLines = getLineSpans(baseContent);
  if (originalLines.length !== baseLines.length) {
    throw new Error(
      "Cannot preserve unchanged lines because the base content has a different line count.",
    );
  }

  let originalLineIndex = 0;
  let result = "";
  for (const group of groupReplacements(baseLines, replacements)) {
    result += originalLines.slice(originalLineIndex, group.startLine).join("");
    const groupStartLine = baseLines[group.startLine];
    const groupEndLine = baseLines[group.endLine - 1];
    if (groupStartLine === undefined || groupEndLine === undefined) {
      throw new Error(OUTSIDE_BASE);
    }
    result += applyReplacements({
      content: baseContent.slice(groupStartLine.start, groupEndLine.end),
      offset: groupStartLine.start,
      replacements: group.replacements,
    });
    originalLineIndex = group.endLine;
  }
  return result + originalLines.slice(originalLineIndex).join("");
}

const editReplacements = {
  applyReplacements,
  applyReplacementsPreservingUnchangedLines,
};

export default editReplacements;
