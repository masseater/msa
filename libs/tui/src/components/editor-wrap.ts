import { dual } from "effect/Function";

import textBoundaries from "../text-boundaries.ts";
import utils from "../utils.ts";
import editorSegments from "./editor-segments.ts";
import type editorWrapTypes from "./editor-wrap.types.ts";

const { visibleWidth } = utils;
const { graphemeSegments, isPasteMarker } = editorSegments;
const { cjkBreakRegex, isWhitespaceChar } = textBoundaries;

interface WrapProgress {
  readonly line: string;
  readonly maxWidth: number;
  chunks: editorWrapTypes.TextChunk[];
  currentWidth: number;
  chunkStart: number;
  wrapOppIndex: number;
  wrapOppWidth: number;
}

function pushChunk(progress: WrapProgress, endIndex: number): void {
  progress.chunks.push({
    endIndex,
    startIndex: progress.chunkStart,
    text: progress.line.slice(progress.chunkStart, endIndex),
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
      endIndex: charIndex + sc.endIndex,
      startIndex: charIndex + sc.startIndex,
      text: sc.text,
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

const wordWrapLine: {
  (line: string, maxWidth: number, preSegmented?: Intl.SegmentData[]): editorWrapTypes.TextChunk[];
  (
    maxWidth: number,
    preSegmented?: Intl.SegmentData[],
  ): (line: string) => editorWrapTypes.TextChunk[];
} = dual(
  (args) => typeof args[0] === "string",
  (
    line: string,
    maxWidth: number,
    preSegmented?: Intl.SegmentData[],
  ): editorWrapTypes.TextChunk[] => {
    if (line === "" || maxWidth <= 0) {
      return [{ endIndex: 0, startIndex: 0, text: "" }];
    }
    if (visibleWidth(line) <= maxWidth) {
      return [{ endIndex: line.length, startIndex: 0, text: line }];
    }

    const segments = preSegmented ?? graphemeSegments(line);
    const progress: WrapProgress = {
      chunkStart: 0,
      chunks: [],
      currentWidth: 0,
      line,
      maxWidth,
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
      endIndex: line.length,
      startIndex: progress.chunkStart,
      text: line.slice(progress.chunkStart),
    });
    return progress.chunks;
  },
);

const buildVisualLineMap: {
  (text: editorWrapTypes.WrappableText, width: number): editorWrapTypes.VisualLine[];
  (width: number): (text: editorWrapTypes.WrappableText) => editorWrapTypes.VisualLine[];
} = dual(2, (text: editorWrapTypes.WrappableText, width: number): editorWrapTypes.VisualLine[] => {
  const visualLines: editorWrapTypes.VisualLine[] = [];
  for (const [i, rawLine] of text.lines.entries()) {
    const line = rawLine || "";
    if (line.length === 0) {
      visualLines.push({ length: 0, logicalLine: i, startCol: 0 });
    } else if (visibleWidth(line) <= width) {
      visualLines.push({ length: line.length, logicalLine: i, startCol: 0 });
    } else {
      for (const chunk of wordWrapLine(line, width, text.graphemes(line))) {
        visualLines.push({
          length: chunk.endIndex - chunk.startIndex,
          logicalLine: i,
          startCol: chunk.startIndex,
        });
      }
    }
  }
  return visualLines;
});

const isLastSegmentOfLine: {
  (visualLines: readonly editorWrapTypes.VisualLine[], index: number): boolean;
  (index: number): (visualLines: readonly editorWrapTypes.VisualLine[]) => boolean;
} = dual(
  2,
  (visualLines: readonly editorWrapTypes.VisualLine[], index: number): boolean =>
    index === visualLines.length - 1 ||
    visualLines[index + 1]?.logicalLine !== visualLines[index]?.logicalLine,
);

const findVisualLineAt: {
  (visualLines: readonly editorWrapTypes.VisualLine[], line: number, col: number): number;
  (line: number, col: number): (visualLines: readonly editorWrapTypes.VisualLine[]) => number;
} = dual(
  3,
  (visualLines: readonly editorWrapTypes.VisualLine[], line: number, col: number): number => {
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
  },
);

function layoutChunk(
  chunk: editorWrapTypes.TextChunk,
  isLastChunk: boolean,
  cursorPos: number,
): editorWrapTypes.LayoutLine {
  const hasCursor = isLastChunk
    ? cursorPos >= chunk.startIndex
    : cursorPos >= chunk.startIndex && cursorPos < chunk.endIndex;
  if (!hasCursor) return { hasCursor: false, text: chunk.text };
  const offset = cursorPos - chunk.startIndex;
  return {
    cursorPos: isLastChunk ? offset : Math.min(offset, chunk.text.length),
    hasCursor: true,
    text: chunk.text,
  };
}

function layoutLogicalLine(
  text: editorWrapTypes.WrappableText,
  line: string,
  isCurrentLine: boolean,
  contentWidth: number,
): editorWrapTypes.LayoutLine[] {
  if (visibleWidth(line) <= contentWidth) {
    return [
      isCurrentLine
        ? { cursorPos: text.cursorCol, hasCursor: true, text: line }
        : { hasCursor: false, text: line },
    ];
  }
  const chunks = wordWrapLine(line, contentWidth, text.graphemes(line));
  return chunks.map((chunk, chunkIndex) =>
    isCurrentLine
      ? layoutChunk(chunk, chunkIndex === chunks.length - 1, text.cursorCol)
      : { hasCursor: false, text: chunk.text },
  );
}

const layoutText: {
  (text: editorWrapTypes.WrappableText, contentWidth: number): editorWrapTypes.LayoutLine[];
  (contentWidth: number): (text: editorWrapTypes.WrappableText) => editorWrapTypes.LayoutLine[];
} = dual(
  2,
  (text: editorWrapTypes.WrappableText, contentWidth: number): editorWrapTypes.LayoutLine[] => {
    if (text.lines.length === 0 || (text.lines.length === 1 && text.lines[0] === "")) {
      return [{ cursorPos: 0, hasCursor: true, text: "" }];
    }
    return text.lines.flatMap((rawLine, i) =>
      layoutLogicalLine(text, rawLine || "", i === text.cursorLine, contentWidth),
    );
  },
);

const editorWrap = {
  buildVisualLineMap,
  findVisualLineAt,
  isLastSegmentOfLine,
  layoutText,
  wordWrapLine,
};

export default editorWrap;
