import { dual } from "effect/Function";

import { cjkBreakRegex, isWhitespaceChar } from "../text-boundaries.ts";
import { visibleWidth } from "../utils.ts";
import { graphemeSegments, isPasteMarker } from "./editor-segments.ts";

export interface TextChunk {
  text: string;
  startIndex: number;
  endIndex: number;
}

interface WrapProgress {
  readonly line: string;
  readonly maxWidth: number;
  chunks: TextChunk[];
  currentWidth: number;
  chunkStart: number;
  wrapOppIndex: number;
  wrapOppWidth: number;
}

function pushChunk(progress: WrapProgress, endIndex: number): void {
  progress.chunks.push({
    text: progress.line.slice(progress.chunkStart, endIndex),
    startIndex: progress.chunkStart,
    endIndex,
  });
  progress.chunkStart = endIndex;
}

function breakBefore(progress: WrapProgress, charIndex: number, gWidth: number): void {
  if (
    progress.wrapOppIndex >= 0 &&
    progress.currentWidth - progress.wrapOppWidth + gWidth <= progress.maxWidth
  ) {
    pushChunk(progress, progress.wrapOppIndex);
    progress.currentWidth -= progress.wrapOppWidth;
  } else if (progress.chunkStart < charIndex) {
    pushChunk(progress, charIndex);
    progress.currentWidth = 0;
  }
  progress.wrapOppIndex = -1;
}

function splitWideGrapheme(progress: WrapProgress, grapheme: string, charIndex: number): void {
  const subChunks = wordWrapLine(grapheme, progress.maxWidth);
  for (const sc of subChunks.slice(0, -1)) {
    progress.chunks.push({
      text: sc.text,
      startIndex: charIndex + sc.startIndex,
      endIndex: charIndex + sc.endIndex,
    });
  }
  const last = subChunks[subChunks.length - 1]!;
  progress.chunkStart = charIndex + last.startIndex;
  progress.currentWidth = visibleWidth(last.text);
  progress.wrapOppIndex = -1;
}

function isWrapOpportunity(grapheme: string, next: Intl.SegmentData): boolean {
  const isWs = !isPasteMarker(grapheme) && isWhitespaceChar(grapheme);
  if (isWs) return isPasteMarker(next.segment) || !isWhitespaceChar(next.segment);
  if (isWhitespaceChar(next.segment)) return false;
  const isCjk = !isPasteMarker(grapheme) && cjkBreakRegex.test(grapheme);
  const nextIsCjk = !isPasteMarker(next.segment) && cjkBreakRegex.test(next.segment);
  return isCjk || nextIsCjk;
}

export const wordWrapLine: {
  (line: string, maxWidth: number, preSegmented?: Intl.SegmentData[]): TextChunk[];
  (maxWidth: number, preSegmented?: Intl.SegmentData[]): (line: string) => TextChunk[];
} = dual(
  (args) => typeof args[0] === "string",
  (line: string, maxWidth: number, preSegmented?: Intl.SegmentData[]): TextChunk[] => {
    if (line === "" || maxWidth <= 0) {
      return [{ text: "", startIndex: 0, endIndex: 0 }];
    }
    if (visibleWidth(line) <= maxWidth) {
      return [{ text: line, startIndex: 0, endIndex: line.length }];
    }

    const segments = preSegmented ?? graphemeSegments(line);
    const progress: WrapProgress = {
      line,
      maxWidth,
      chunks: [],
      currentWidth: 0,
      chunkStart: 0,
      wrapOppIndex: -1,
      wrapOppWidth: 0,
    };
    for (const [i, seg] of segments.entries()) {
      const gWidth = visibleWidth(seg.segment);
      if (progress.currentWidth + gWidth > maxWidth) breakBefore(progress, seg.index, gWidth);
      if (gWidth > maxWidth) {
        splitWideGrapheme(progress, seg.segment, seg.index);
        continue;
      }
      progress.currentWidth += gWidth;
      const next = segments[i + 1];
      if (next !== undefined && isWrapOpportunity(seg.segment, next)) {
        progress.wrapOppIndex = next.index;
        progress.wrapOppWidth = progress.currentWidth;
      }
    }
    progress.chunks.push({
      text: line.slice(progress.chunkStart),
      startIndex: progress.chunkStart,
      endIndex: line.length,
    });
    return progress.chunks;
  },
);

export interface VisualLine {
  logicalLine: number;
  startCol: number;
  length: number;
}

export interface LayoutLine {
  text: string;
  hasCursor: boolean;
  cursorPos?: number;
}

export interface WrappableText {
  readonly lines: readonly string[];
  readonly cursorLine: number;
  readonly cursorCol: number;
  graphemes(text: string): Intl.SegmentData[];
}

export const buildVisualLineMap: {
  (text: WrappableText, width: number): VisualLine[];
  (width: number): (text: WrappableText) => VisualLine[];
} = dual(2, (text: WrappableText, width: number): VisualLine[] => {
  const visualLines: VisualLine[] = [];
  for (const [i, rawLine] of text.lines.entries()) {
    const line = rawLine || "";
    if (line.length === 0) {
      visualLines.push({ logicalLine: i, startCol: 0, length: 0 });
    } else if (visibleWidth(line) <= width) {
      visualLines.push({ logicalLine: i, startCol: 0, length: line.length });
    } else {
      for (const chunk of wordWrapLine(line, width, text.graphemes(line))) {
        visualLines.push({
          logicalLine: i,
          startCol: chunk.startIndex,
          length: chunk.endIndex - chunk.startIndex,
        });
      }
    }
  }
  return visualLines;
});

export const isLastSegmentOfLine: {
  (visualLines: readonly VisualLine[], index: number): boolean;
  (index: number): (visualLines: readonly VisualLine[]) => boolean;
} = dual(
  2,
  (visualLines: readonly VisualLine[], index: number): boolean =>
    index === visualLines.length - 1 ||
    visualLines[index + 1]?.logicalLine !== visualLines[index]?.logicalLine,
);

export const findVisualLineAt: {
  (visualLines: readonly VisualLine[], line: number, col: number): number;
  (line: number, col: number): (visualLines: readonly VisualLine[]) => number;
} = dual(3, (visualLines: readonly VisualLine[], line: number, col: number): number => {
  for (const [i, vl] of visualLines.entries()) {
    if (vl.logicalLine !== line) continue;
    const offset = col - vl.startCol;
    if (
      offset >= 0 &&
      (offset < vl.length || (isLastSegmentOfLine(visualLines, i) && offset === vl.length))
    ) {
      return i;
    }
  }
  return visualLines.length - 1;
});

function layoutChunk(chunk: TextChunk, isLastChunk: boolean, cursorPos: number): LayoutLine {
  const hasCursor = isLastChunk
    ? cursorPos >= chunk.startIndex
    : cursorPos >= chunk.startIndex && cursorPos < chunk.endIndex;
  if (!hasCursor) return { text: chunk.text, hasCursor: false };
  const offset = cursorPos - chunk.startIndex;
  return {
    text: chunk.text,
    hasCursor: true,
    cursorPos: isLastChunk ? offset : Math.min(offset, chunk.text.length),
  };
}

function layoutLogicalLine(
  text: WrappableText,
  line: string,
  isCurrentLine: boolean,
  contentWidth: number,
): LayoutLine[] {
  if (visibleWidth(line) <= contentWidth) {
    return [
      isCurrentLine
        ? { text: line, hasCursor: true, cursorPos: text.cursorCol }
        : { text: line, hasCursor: false },
    ];
  }
  const chunks = wordWrapLine(line, contentWidth, text.graphemes(line));
  return chunks.map((chunk, chunkIndex) =>
    isCurrentLine
      ? layoutChunk(chunk, chunkIndex === chunks.length - 1, text.cursorCol)
      : { text: chunk.text, hasCursor: false },
  );
}

export const layoutText: {
  (text: WrappableText, contentWidth: number): LayoutLine[];
  (contentWidth: number): (text: WrappableText) => LayoutLine[];
} = dual(2, (text: WrappableText, contentWidth: number): LayoutLine[] => {
  if (text.lines.length === 0 || (text.lines.length === 1 && text.lines[0] === "")) {
    return [{ text: "", hasCursor: true, cursorPos: 0 }];
  }
  return text.lines.flatMap((rawLine, i) =>
    layoutLogicalLine(text, rawLine || "", i === text.cursorLine, contentWidth),
  );
});
