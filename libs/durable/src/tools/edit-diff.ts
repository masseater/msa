import { Function } from "effect";

import type { Dual3 } from "../dual.ts";
import { duplicateError, emptyOldTextError, noChangeError, notFoundError } from "./edit-display.ts";

function detectLineEnding(content: string): "\r\n" | "\n" {
  const crlfIdx = content.indexOf("\r\n");
  const lfIdx = content.indexOf("\n");
  if (lfIdx === -1) return "\n";
  if (crlfIdx === -1) return "\n";
  return crlfIdx < lfIdx ? "\r\n" : "\n";
}

function normalizeToLF(text: string): string {
  return text.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");
}

const restoreLineEndings = (text: string, ending: "\r\n" | "\n"): string =>
  ending === "\r\n" ? text.replace(/\n/gu, "\r\n") : text;

function normalizeForFuzzyMatch(text: string): string {
  return text
    .normalize("NFKC")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/[\u2018\u2019\u201A\u201B]/gu, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/gu, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/gu, "-")
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/gu, " ");
}

function splitLinesWithEndings(content: string): string[] {
  return content.match(/[^\n]*\n|[^\n]+/gu) ?? [];
}

interface LineSpan {
  start: number;
  end: number;
}

interface MatchedEdit {
  editIndex: number;
  matchIndex: number;
  matchLength: number;
  newText: string;
}

type TextReplacement = Pick<MatchedEdit, "matchIndex" | "matchLength" | "newText">;

function getLineSpans(content: string): LineSpan[] {
  let offset = 0;
  return splitLinesWithEndings(content).map((line) => {
    const span = { start: offset, end: offset + line.length };
    offset = span.end;
    return span;
  });
}

function getReplacementLineRange(lines: LineSpan[], replacement: TextReplacement) {
  const replacementStart = replacement.matchIndex;
  const replacementEnd = replacement.matchIndex + replacement.matchLength;

  const startLine = lines.findIndex(
    (line) => replacementStart >= line.start && replacementStart < line.end,
  );
  if (startLine === -1) {
    throw new Error("Replacement range is outside the base content.");
  }

  let endLine = startLine;
  let endSpan = lines[endLine];
  while (endSpan !== undefined && endSpan.end < replacementEnd) {
    endLine++;
    endSpan = lines[endLine];
  }
  if (endSpan === undefined) {
    throw new Error("Replacement range is outside the base content.");
  }

  return { startLine, endLine: endLine + 1 };
}

function applyReplacements(content: string, replacements: TextReplacement[], offset = 0): string {
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

type ReplacementGroup = { startLine: number; endLine: number; replacements: TextReplacement[] };

function groupByLines(lines: LineSpan[], replacements: TextReplacement[]): ReplacementGroup[] {
  const groups: ReplacementGroup[] = [];
  const sortedReplacements = [...replacements].sort((a, b) => a.matchIndex - b.matchIndex);
  for (const replacement of sortedReplacements) {
    const range = getReplacementLineRange(lines, replacement);
    const current = groups[groups.length - 1];
    if (current !== undefined && range.startLine < current.endLine) {
      current.endLine = Math.max(current.endLine, range.endLine);
      current.replacements.push(replacement);
      continue;
    }
    groups.push({ ...range, replacements: [replacement] });
  }
  return groups;
}

function applyReplacementsPreservingUnchangedLines(
  originalContent: string,
  baseContent: string,
  replacements: TextReplacement[],
): string {
  const originalLines = splitLinesWithEndings(originalContent);
  const baseLines = getLineSpans(baseContent);
  if (originalLines.length !== baseLines.length) {
    throw new Error(
      "Cannot preserve unchanged lines because the base content has a different line count.",
    );
  }
  let originalLineIndex = 0;
  let result = "";
  for (const group of groupByLines(baseLines, replacements)) {
    result += originalLines.slice(originalLineIndex, group.startLine).join("");
    const startSpan = baseLines[group.startLine];
    const endSpan = baseLines[group.endLine - 1];
    if (startSpan === undefined || endSpan === undefined) {
      throw new Error("Replacement range is outside the base content.");
    }
    result += applyReplacements(
      baseContent.slice(startSpan.start, endSpan.end),
      group.replacements,
      startSpan.start,
    );
    originalLineIndex = group.endLine;
  }
  return result + originalLines.slice(originalLineIndex).join("");
}

interface FuzzyMatchResult {
  found: boolean;
  index: number;
  matchLength: number;
  usedFuzzyMatch: boolean;
  contentForReplacement: string;
}

export interface Edit {
  oldText: string;
  newText: string;
}

export interface AppliedEditsResult {
  readonly baseContent: string;
  readonly newContent: string;
  readonly fileContent: string;
}

function fuzzyFindText(content: string, oldText: string): FuzzyMatchResult {
  const exactIndex = content.indexOf(oldText);
  if (exactIndex !== -1) {
    return {
      found: true,
      index: exactIndex,
      matchLength: oldText.length,
      usedFuzzyMatch: false,
      contentForReplacement: content,
    };
  }

  const fuzzyContent = normalizeForFuzzyMatch(content);
  const fuzzyOldText = normalizeForFuzzyMatch(oldText);
  const fuzzyIndex = fuzzyContent.indexOf(fuzzyOldText);

  if (fuzzyIndex === -1) {
    return {
      found: false,
      index: -1,
      matchLength: 0,
      usedFuzzyMatch: false,
      contentForReplacement: content,
    };
  }

  return {
    found: true,
    index: fuzzyIndex,
    matchLength: fuzzyOldText.length,
    usedFuzzyMatch: true,
    contentForReplacement: fuzzyContent,
  };
}

function stripBom(content: string): { bom: string; text: string } {
  return content.startsWith("\uFEFF")
    ? { bom: "\uFEFF", text: content.slice(1) }
    : { bom: "", text: content };
}

function countOccurrences(content: string, oldText: string): number {
  const fuzzyContent = normalizeForFuzzyMatch(content);
  const fuzzyOldText = normalizeForFuzzyMatch(oldText);
  return fuzzyContent.split(fuzzyOldText).length - 1;
}

function normalizedEditsOf(edits: Edit[], path: string): Edit[] {
  const normalizedEdits = edits.map((edit) => ({
    oldText: normalizeToLF(edit.oldText),
    newText: normalizeToLF(edit.newText),
  }));
  for (const [i, edit] of normalizedEdits.entries()) {
    if (edit.oldText.length === 0) throw emptyOldTextError(path, i, normalizedEdits.length);
  }
  return normalizedEdits;
}

function matchEdits(content: string, edits: Edit[], path: string): MatchedEdit[] {
  const matchedEdits = edits.map((edit, i): MatchedEdit => {
    const matchResult = fuzzyFindText(content, edit.oldText);
    if (!matchResult.found) throw notFoundError(path, i, edits.length);
    const occurrences = countOccurrences(content, edit.oldText);
    if (occurrences > 1) throw duplicateError(path, i, edits.length, occurrences);
    return {
      editIndex: i,
      matchIndex: matchResult.index,
      matchLength: matchResult.matchLength,
      newText: edit.newText,
    };
  });
  matchedEdits.sort((a, b) => a.matchIndex - b.matchIndex);
  for (const [i, current] of matchedEdits.entries()) {
    const previous = matchedEdits[i - 1];
    if (previous === undefined) continue;
    if (previous.matchIndex + previous.matchLength > current.matchIndex) {
      throw new Error(
        `edits[${previous.editIndex}] and edits[${current.editIndex}] overlap in ${path}. Merge them into one edit or target disjoint regions.`,
      );
    }
  }
  return matchedEdits;
}

function applyEditsToNormalizedContent(
  normalizedContent: string,
  edits: Edit[],
  path: string,
): string {
  const normalizedEdits = normalizedEditsOf(edits, path);
  const usedFuzzyMatch = normalizedEdits.some(
    (edit) => fuzzyFindText(normalizedContent, edit.oldText).usedFuzzyMatch,
  );
  const replacementBaseContent = usedFuzzyMatch
    ? normalizeForFuzzyMatch(normalizedContent)
    : normalizedContent;
  const matchedEdits = matchEdits(replacementBaseContent, normalizedEdits, path);
  const newContent = usedFuzzyMatch
    ? applyReplacementsPreservingUnchangedLines(
        normalizedContent,
        replacementBaseContent,
        matchedEdits,
      )
    : applyReplacements(replacementBaseContent, matchedEdits);
  if (normalizedContent === newContent) throw noChangeError(path, normalizedEdits.length);
  return newContent;
}

export const applyEditsToFile: Dual3<string, Edit[], string, AppliedEditsResult> = Function.dual(
  3,
  (raw: string, edits: Edit[], path: string): AppliedEditsResult => {
    const { bom, text } = stripBom(raw);
    const baseContent = normalizeToLF(text);
    const newContent = applyEditsToNormalizedContent(baseContent, edits, path);
    const fileContent = bom + restoreLineEndings(newContent, detectLineEnding(text));
    return { baseContent, newContent, fileContent };
  },
);
