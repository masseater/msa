import editorWrap from "./editor-wrap.ts";
import type editorWrapTypes from "./editor-wrap.types.ts";

const { isLastSegmentOfLine } = editorWrap;

function maxVisualCol(visualLines: readonly editorWrapTypes.VisualLine[], index: number): number {
  const vl = visualLines[index]!;
  return isLastSegmentOfLine(visualLines, index) ? vl.length : Math.max(0, vl.length - 1);
}

function findSplitGrapheme(
  segments: readonly Intl.SegmentData[],
  col: number,
): Intl.SegmentData | undefined {
  return segments.find(
    (seg) => seg.index <= col && seg.segment.length > 1 && col < seg.index + seg.segment.length,
  );
}

function nextVisualLineAfter(
  visualLines: readonly editorWrapTypes.VisualLine[],
  targetVisualLine: number,
  segEnd: number,
): number {
  const logicalLine = visualLines[targetVisualLine]?.logicalLine;
  let next = targetVisualLine + 1;
  let nextVL = visualLines[next];
  while (nextVL !== undefined && nextVL.logicalLine === logicalLine && nextVL.startCol < segEnd) {
    next++;
    nextVL = visualLines[next];
  }
  return next;
}

const editorMotionLines = {
  findSplitGrapheme,
  maxVisualCol,
  nextVisualLineAfter,
};

export default editorMotionLines;
