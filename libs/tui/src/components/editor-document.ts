import { KillRing } from "../kill-ring.ts";
import { isWhitespaceChar } from "../text-boundaries.ts";
import { UndoStack } from "../undo-stack.ts";
import {
  expandPasteMarkers,
  normalizeEditorText,
  PASTE_MARKER_SINGLE,
  renumberPasteMarkers,
  type SegmentMode,
  segmentText,
} from "./editor-segments.ts";
import { type LayoutLine, layoutText, type WrappableText } from "./editor-wrap.ts";

export interface EditorState {
  lines: string[];
  cursorLine: number;
  cursorCol: number;
}

interface EditorSnapshot {
  state: EditorState;
  pastes: Map<number, string>;
  pasteCounter: number;
}

export type EditorAction = "kill" | "yank" | "type-word" | null;

export interface CompletionResult {
  lines: string[];
  cursorLine: number;
  cursorCol: number;
}

export class EditorDocument implements WrappableText {
  state: EditorState = { lines: [""], cursorLine: 0, cursorCol: 0 };
  pastes: Map<number, string> = new Map();
  pasteCounter = 0;
  lastAction: EditorAction = null;
  preferredVisualCol: number | null = null;
  snappedFromCursorCol: number | null = null;
  scrollOffset = 0;
  readonly killRing = new KillRing();
  private readonly undoStack = new UndoStack<EditorSnapshot>();
  private readonly notify: () => void;

  constructor(notify: () => void) {
    this.notify = notify;
  }

  get lines(): readonly string[] {
    return this.state.lines;
  }

  get cursorLine(): number {
    return this.state.cursorLine;
  }

  get cursorCol(): number {
    return this.state.cursorCol;
  }

  segment(text: string, mode: SegmentMode): Iterable<Intl.SegmentData> {
    return segmentText(text, mode, new Set(this.pastes.keys()));
  }

  graphemes(text: string): Intl.SegmentData[] {
    return [...this.segment(text, "grapheme")];
  }

  layout(width: number): LayoutLine[] {
    return layoutText(this, width);
  }

  getText(): string {
    return this.state.lines.join("\n");
  }

  expandedText(): string {
    return expandPasteMarkers(this.getText(), this.pastes);
  }

  isEmpty(): boolean {
    return this.state.lines.length === 1 && this.state.lines[0] === "";
  }

  currentLine(): string {
    return this.state.lines[this.state.cursorLine] || "";
  }

  textBeforeCursor(): string {
    return this.currentLine().slice(0, this.state.cursorCol);
  }

  setCursorCol(col: number): void {
    this.state.cursorCol = col;
    this.preferredVisualCol = null;
    this.snappedFromCursorCol = null;
  }

  changed(): void {
    this.notify();
  }

  pushUndoSnapshot(): void {
    this.undoStack.push({
      state: this.state,
      pastes: this.pastes,
      pasteCounter: this.pasteCounter,
    });
  }

  undo(): void {
    const snapshot = this.undoStack.pop();
    if (snapshot === undefined) return;
    Object.assign(this.state, snapshot.state);
    this.pastes = snapshot.pastes;
    this.pasteCounter = snapshot.pasteCounter;
    this.lastAction = null;
    this.preferredVisualCol = null;
    this.notify();
  }

  replaceText(text: string, cursorPlacement: "start" | "end" = "end"): void {
    const lines = text.split("\n");
    this.state.lines = lines.length === 0 ? [""] : lines;
    this.state.cursorLine = cursorPlacement === "start" ? 0 : this.state.lines.length - 1;
    this.setCursorCol(cursorPlacement === "start" ? 0 : this.currentLine().length);
    this.scrollOffset = 0;
    this.notify();
  }

  restoreState(state: EditorState): void {
    this.state = state;
    this.preferredVisualCol = null;
    this.snappedFromCursorCol = null;
    this.scrollOffset = 0;
    this.notify();
  }

  reset(): string {
    const result = this.expandedText().trim();
    this.state = { lines: [""], cursorLine: 0, cursorCol: 0 };
    this.pastes.clear();
    this.pasteCounter = 0;
    this.scrollOffset = 0;
    this.undoStack.clear();
    this.lastAction = null;
    return result;
  }

  applyCompletion(result: CompletionResult): void {
    this.state.lines = result.lines;
    this.state.cursorLine = result.cursorLine;
    this.setCursorCol(result.cursorCol);
  }

  addPaste(text: string): number {
    this.pasteCounter++;
    this.pastes.set(this.pasteCounter, text);
    return this.pasteCounter;
  }

  insertText(text: string): void {
    if (text === "") return;
    const normalized = normalizeEditorText(text);
    const insertedLines = normalized.split("\n");
    const currentLine = this.currentLine();
    const beforeCursor = currentLine.slice(0, this.state.cursorCol);
    const afterCursor = currentLine.slice(this.state.cursorCol);

    if (insertedLines.length === 1) {
      this.state.lines[this.state.cursorLine] = beforeCursor + normalized + afterCursor;
      this.setCursorCol(this.state.cursorCol + normalized.length);
    } else {
      const lastInserted = insertedLines[insertedLines.length - 1];
      this.state.lines = [
        ...this.state.lines.slice(0, this.state.cursorLine),
        beforeCursor + insertedLines[0],
        ...insertedLines.slice(1, -1),
        lastInserted + afterCursor,
        ...this.state.lines.slice(this.state.cursorLine + 1),
      ];
      this.state.cursorLine += insertedLines.length - 1;
      this.setCursorCol((lastInserted || "").length);
    }
    this.notify();
  }

  insertCharacter(char: string, skipUndoCoalescing?: boolean): void {
    if (skipUndoCoalescing !== true) {
      if (isWhitespaceChar(char) || this.lastAction !== "type-word") {
        this.pushUndoSnapshot();
      }
      this.lastAction = "type-word";
    }
    const line = this.currentLine();
    this.state.lines[this.state.cursorLine] =
      line.slice(0, this.state.cursorCol) + char + line.slice(this.state.cursorCol);
    this.setCursorCol(this.state.cursorCol + char.length);
    this.notify();
  }

  insertNewLine(): void {
    this.lastAction = null;
    this.pushUndoSnapshot();
    const currentLine = this.currentLine();
    this.state.lines[this.state.cursorLine] = currentLine.slice(0, this.state.cursorCol);
    this.state.lines.splice(this.state.cursorLine + 1, 0, currentLine.slice(this.state.cursorCol));
    this.state.cursorLine++;
    this.setCursorCol(0);
    this.notify();
  }

  joinWithPreviousLine(): void {
    const currentLine = this.currentLine();
    const previousLine = this.state.lines[this.state.cursorLine - 1] || "";
    this.state.lines[this.state.cursorLine - 1] = previousLine + currentLine;
    this.state.lines.splice(this.state.cursorLine, 1);
    this.state.cursorLine--;
    this.setCursorCol(previousLine.length);
  }

  joinWithNextLine(): void {
    const currentLine = this.currentLine();
    const nextLine = this.state.lines[this.state.cursorLine + 1] || "";
    this.state.lines[this.state.cursorLine] = currentLine + nextLine;
    this.state.lines.splice(this.state.cursorLine + 1, 1);
  }

  deleteBackward(): void {
    this.lastAction = null;
    if (this.state.cursorCol > 0) {
      this.pushUndoSnapshot();
      this.deleteGraphemeBeforeCursor();
    } else if (this.state.cursorLine > 0) {
      this.pushUndoSnapshot();
      this.joinWithPreviousLine();
    }
    this.notify();
  }

  deleteForward(): void {
    this.lastAction = null;
    const currentLine = this.currentLine();
    if (this.state.cursorCol < currentLine.length) {
      this.pushUndoSnapshot();
      const firstGrapheme = this.graphemes(currentLine.slice(this.state.cursorCol))[0];
      const graphemeLength = firstGrapheme === undefined ? 1 : firstGrapheme.segment.length;
      this.state.lines[this.state.cursorLine] =
        currentLine.slice(0, this.state.cursorCol) +
        currentLine.slice(this.state.cursorCol + graphemeLength);
    } else if (this.state.cursorLine < this.state.lines.length - 1) {
      this.pushUndoSnapshot();
      this.joinWithNextLine();
    }
    this.notify();
  }

  private deleteGraphemeBeforeCursor(): void {
    const graphemes = this.graphemes(this.textBeforeCursor());
    const lastGrapheme = graphemes[graphemes.length - 1];
    const graphemeLength = lastGrapheme === undefined ? 1 : lastGrapheme.segment.length;
    const pasteMarker =
      lastGrapheme === undefined ? null : PASTE_MARKER_SINGLE.exec(lastGrapheme.segment);
    if (pasteMarker !== null) {
      this.removePaste(Number(pasteMarker[1]));
    }
    const line = this.currentLine();
    this.state.lines[this.state.cursorLine] =
      line.slice(0, this.state.cursorCol - graphemeLength) + line.slice(this.state.cursorCol);
    this.setCursorCol(this.state.cursorCol - graphemeLength);
  }

  private removePaste(targetId: number): void {
    this.pastes.delete(targetId);
    this.pasteCounter--;
    const higherIds = [...this.pastes.keys()].filter((id) => id > targetId).sort((a, b) => a - b);
    for (const id of higherIds) {
      this.pastes.set(id - 1, this.pastes.get(id)!);
      this.pastes.delete(id);
    }
    this.state.lines = renumberPasteMarkers(this.state.lines, targetId);
  }
}
