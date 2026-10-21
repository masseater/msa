import utils from "../utils.ts";
import wordNavigation from "../word-navigation.ts";
import type editorDocumentTypes from "./editor-document.types.ts";
import editorMotionLines from "./editor-motion-lines.ts";
import type editorMotionTypes from "./editor-motion.types.ts";
import editorSegments from "./editor-segments.ts";
import editorWrap from "./editor-wrap.ts";
import type editorWrapTypes from "./editor-wrap.types.ts";

const { findSplitGrapheme, maxVisualCol, nextVisualLineAfter } = editorMotionLines;

const { buildVisualLineMap, findVisualLineAt, isLastSegmentOfLine } = editorWrap;
const { findWordBackward, findWordForward } = wordNavigation;
const { isPasteMarker } = editorSegments;
const { visibleWidth } = utils;

export default class EditorMotion {
  private readonly doc: editorDocumentTypes.EditorDocument;

  constructor(doc: editorDocumentTypes.EditorDocument) {
    this.doc = doc;
  }

  visualLines(width: number): editorWrapTypes.VisualLine[] {
    return buildVisualLineMap(this.doc, width);
  }

  currentVisualLine(visualLines: readonly editorWrapTypes.VisualLine[]): number {
    return findVisualLineAt(visualLines, this.doc.state.cursorLine, this.doc.state.cursorCol);
  }

  isOnFirstVisualLine(width: number): boolean {
    return this.currentVisualLine(this.visualLines(width)) === 0;
  }

  isOnLastVisualLine(width: number): boolean {
    const visualLines = this.visualLines(width);
    return this.currentVisualLine(visualLines) === visualLines.length - 1;
  }

  moveToLineStart(): void {
    this.doc.lastAction = null;
    this.doc.setCursorCol(0);
  }

  moveToLineEnd(): void {
    this.doc.lastAction = null;
    this.doc.setCursorCol(this.doc.currentLine().length);
  }

  moveCursor(deltaLine: number, deltaCol: number, width: number): void {
    this.doc.lastAction = null;
    const visualLines = this.visualLines(width);
    const currentVisualLine = this.currentVisualLine(visualLines);
    if (deltaLine !== 0) {
      const targetVisualLine = currentVisualLine + deltaLine;
      if (targetVisualLine >= 0 && targetVisualLine < visualLines.length) {
        this.moveToVisualLine(visualLines, currentVisualLine, targetVisualLine);
      }
    }
    if (deltaCol > 0) {
      this.moveCursorRight(visualLines[currentVisualLine]);
    } else if (deltaCol < 0) {
      this.moveCursorLeft();
    }
  }

  pageScroll(direction: -1 | 1, width: number, terminalRows: number): void {
    this.doc.lastAction = null;
    const pageSize = Math.max(5, Math.floor(terminalRows * 0.3));
    const visualLines = this.visualLines(width);
    const currentVisualLine = this.currentVisualLine(visualLines);
    const targetVisualLine = Math.max(
      0,
      Math.min(visualLines.length - 1, currentVisualLine + direction * pageSize),
    );
    this.moveToVisualLine(visualLines, currentVisualLine, targetVisualLine);
  }

  moveWordBackwards(): void {
    this.doc.lastAction = null;
    const { state } = this.doc;
    if (state.cursorCol === 0) {
      if (state.cursorLine > 0) {
        state.cursorLine--;
        this.doc.setCursorCol(this.doc.currentLine().length);
      }
      return;
    }
    this.doc.setCursorCol(
      findWordBackward(this.doc.currentLine(), state.cursorCol, {
        isAtomicSegment: isPasteMarker,
        segment: (text) => this.doc.segment(text, "word"),
      }),
    );
  }

  moveWordForwards(): void {
    this.doc.lastAction = null;
    const { state } = this.doc;
    const currentLine = this.doc.currentLine();
    if (state.cursorCol >= currentLine.length) {
      if (state.cursorLine < state.lines.length - 1) {
        state.cursorLine++;
        this.doc.setCursorCol(0);
      }
      return;
    }
    this.doc.setCursorCol(
      findWordForward(currentLine, state.cursorCol, {
        isAtomicSegment: isPasteMarker,
        segment: (text) => this.doc.segment(text, "word"),
      }),
    );
  }

  jumpToChar(char: string, direction: "forward" | "backward"): void {
    this.doc.lastAction = null;
    const { state } = this.doc;
    const isForward = direction === "forward";
    const end = isForward ? state.lines.length : -1;
    const step = isForward ? 1 : -1;
    for (let lineIdx = state.cursorLine; lineIdx !== end; lineIdx += step) {
      const line = state.lines[lineIdx] || "";
      const offset = isForward ? 1 : -1;
      const searchFrom = lineIdx === state.cursorLine ? state.cursorCol + offset : undefined;
      const idx = isForward ? line.indexOf(char, searchFrom) : line.lastIndexOf(char, searchFrom);
      if (idx !== -1) {
        state.cursorLine = lineIdx;
        this.doc.setCursorCol(idx);
        return;
      }
    }
  }

  clickTarget(
    width: number,
    visualLineIndex: number,
    targetColumn: number,
  ): editorMotionTypes.CursorTarget | undefined {
    const visualLines = this.visualLines(width);
    const visualLine = visualLines[visualLineIndex];
    if (visualLine === undefined) return undefined;
    const logicalLine = this.doc.state.lines[visualLine.logicalLine] ?? "";
    const chunk = logicalLine.slice(visualLine.startCol, visualLine.startCol + visualLine.length);
    let visibleColumn = 0;
    let targetIndex = chunk.length;
    let lastGraphemeIndex = 0;
    for (const grapheme of this.doc.segment(chunk, "grapheme")) {
      const nextColumn = visibleColumn + visibleWidth(grapheme.segment);
      lastGraphemeIndex = grapheme.index;
      if (targetColumn < nextColumn) {
        targetIndex = grapheme.index;
        break;
      }
      visibleColumn = nextColumn;
    }
    if (
      !isLastSegmentOfLine(visualLines, visualLineIndex) &&
      targetIndex === chunk.length &&
      chunk.length > 0
    ) {
      targetIndex = lastGraphemeIndex;
    }
    return { col: visualLine.startCol + targetIndex, line: visualLine.logicalLine };
  }

  private moveToVisualLine(
    visualLines: readonly editorWrapTypes.VisualLine[],
    currentVisualLine: number,
    targetVisualLine: number,
  ): void {
    const currentVL = visualLines[currentVisualLine];
    const targetVL = visualLines[targetVisualLine];
    if (currentVL === undefined || targetVL === undefined) return;

    const moveToVisualCol = this.computeVerticalMoveColumn(
      this.sourceVisualCol(visualLines, currentVL),
      maxVisualCol(visualLines, currentVisualLine),
      maxVisualCol(visualLines, targetVisualLine),
    );
    const { state } = this.doc;
    state.cursorLine = targetVL.logicalLine;
    const logicalLine = state.lines[targetVL.logicalLine] || "";
    state.cursorCol = Math.min(targetVL.startCol + moveToVisualCol, logicalLine.length);

    const split = findSplitGrapheme(this.doc.graphemes(logicalLine), state.cursorCol);
    if (split === undefined) {
      this.doc.snappedFromCursorCol = null;
      return;
    }
    if (split.index < targetVL.startCol && targetVisualLine > currentVisualLine) {
      const segEnd = split.index + split.segment.length;
      const next = nextVisualLineAfter(visualLines, targetVisualLine, segEnd);
      if (next < visualLines.length) {
        this.moveToVisualLine(visualLines, currentVisualLine, next);
        return;
      }
    }
    this.doc.snappedFromCursorCol = state.cursorCol;
    state.cursorCol = split.index;
  }

  private sourceVisualCol(
    visualLines: readonly editorWrapTypes.VisualLine[],
    currentVL: editorWrapTypes.VisualLine,
  ): number {
    const snapped = this.doc.snappedFromCursorCol;
    if (snapped === null) return this.doc.state.cursorCol - currentVL.startCol;
    const vlIndex = findVisualLineAt(visualLines, currentVL.logicalLine, snapped);
    const snappedVL = visualLines[vlIndex];
    if (snappedVL === undefined) {
      throw new Error(`Visual line ${vlIndex} does not exist`);
    }
    return snapped - snappedVL.startCol;
  }

  private computeVerticalMoveColumn(
    currentVisualCol: number,
    sourceMaxVisualCol: number,
    targetMaxVisualCol: number,
  ): number {
    const preferred = this.doc.preferredVisualCol;
    const targetTooShort = targetMaxVisualCol < currentVisualCol;
    if (preferred === null || currentVisualCol < sourceMaxVisualCol) {
      if (targetTooShort) {
        this.doc.preferredVisualCol = currentVisualCol;
        return targetMaxVisualCol;
      }
      this.doc.preferredVisualCol = null;
      return currentVisualCol;
    }
    if (targetTooShort || targetMaxVisualCol < preferred) {
      return targetMaxVisualCol;
    }
    this.doc.preferredVisualCol = null;
    return preferred;
  }

  private moveCursorRight(currentVL: editorWrapTypes.VisualLine | undefined): void {
    const { state } = this.doc;
    const currentLine = this.doc.currentLine();
    if (state.cursorCol < currentLine.length) {
      const firstGrapheme = this.doc.graphemes(currentLine.slice(state.cursorCol))[0];
      this.doc.setCursorCol(
        state.cursorCol + (firstGrapheme === undefined ? 1 : firstGrapheme.segment.length),
      );
    } else if (state.cursorLine < state.lines.length - 1) {
      state.cursorLine++;
      this.doc.setCursorCol(0);
    } else if (currentVL !== undefined) {
      this.doc.preferredVisualCol = state.cursorCol - currentVL.startCol;
    }
  }

  private moveCursorLeft(): void {
    const { state } = this.doc;
    if (state.cursorCol > 0) {
      const graphemes = this.doc.graphemes(this.doc.textBeforeCursor());
      const lastGrapheme = graphemes[graphemes.length - 1];
      this.doc.setCursorCol(
        state.cursorCol - (lastGrapheme === undefined ? 1 : lastGrapheme.segment.length),
      );
    } else if (state.cursorLine > 0) {
      state.cursorLine--;
      this.doc.setCursorCol(this.doc.currentLine().length);
    }
  }
}
