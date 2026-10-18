import type { EditorDocument } from "./editor-document.ts";
import type { EditorMotion } from "./editor-motion.ts";

export class EditorKillCommands {
  private readonly doc: EditorDocument;
  private readonly motion: EditorMotion;

  constructor(doc: EditorDocument, motion: EditorMotion) {
    this.doc = doc;
    this.motion = motion;
  }

  deleteToLineStart(): void {
    const { state } = this.doc;
    const currentLine = this.doc.currentLine();
    if (state.cursorCol > 0) {
      this.doc.pushUndoSnapshot();
      this.kill(currentLine.slice(0, state.cursorCol), true, this.doc.lastAction === "kill");
      state.lines[state.cursorLine] = currentLine.slice(state.cursorCol);
      this.doc.setCursorCol(0);
    } else if (state.cursorLine > 0) {
      this.doc.pushUndoSnapshot();
      this.kill("\n", true, this.doc.lastAction === "kill");
      this.doc.joinWithPreviousLine();
    }
    this.doc.changed();
  }

  deleteToLineEnd(): void {
    const { state } = this.doc;
    const currentLine = this.doc.currentLine();
    if (state.cursorCol < currentLine.length) {
      this.doc.pushUndoSnapshot();
      this.kill(currentLine.slice(state.cursorCol), false, this.doc.lastAction === "kill");
      state.lines[state.cursorLine] = currentLine.slice(0, state.cursorCol);
    } else if (state.cursorLine < state.lines.length - 1) {
      this.doc.pushUndoSnapshot();
      this.kill("\n", false, this.doc.lastAction === "kill");
      this.doc.joinWithNextLine();
    }
    this.doc.changed();
  }

  deleteWordBackward(): void {
    const { state } = this.doc;
    const currentLine = this.doc.currentLine();
    if (state.cursorCol === 0) {
      if (state.cursorLine > 0) {
        this.doc.pushUndoSnapshot();
        this.kill("\n", true, this.doc.lastAction === "kill");
        this.doc.joinWithPreviousLine();
      }
    } else {
      this.doc.pushUndoSnapshot();
      const wasKill = this.doc.lastAction === "kill";
      const oldCursorCol = state.cursorCol;
      this.motion.moveWordBackwards();
      const deleteFrom = state.cursorCol;
      this.doc.setCursorCol(oldCursorCol);
      this.kill(currentLine.slice(deleteFrom, state.cursorCol), true, wasKill);
      state.lines[state.cursorLine] =
        currentLine.slice(0, deleteFrom) + currentLine.slice(state.cursorCol);
      this.doc.setCursorCol(deleteFrom);
    }
    this.doc.changed();
  }

  deleteWordForward(): void {
    const { state } = this.doc;
    const currentLine = this.doc.currentLine();
    if (state.cursorCol >= currentLine.length) {
      if (state.cursorLine < state.lines.length - 1) {
        this.doc.pushUndoSnapshot();
        this.kill("\n", false, this.doc.lastAction === "kill");
        this.doc.joinWithNextLine();
      }
    } else {
      this.doc.pushUndoSnapshot();
      const wasKill = this.doc.lastAction === "kill";
      const oldCursorCol = state.cursorCol;
      this.motion.moveWordForwards();
      const deleteTo = state.cursorCol;
      this.doc.setCursorCol(oldCursorCol);
      this.kill(currentLine.slice(state.cursorCol, deleteTo), false, wasKill);
      state.lines[state.cursorLine] =
        currentLine.slice(0, state.cursorCol) + currentLine.slice(deleteTo);
    }
    this.doc.changed();
  }

  yank(): boolean {
    const text = this.doc.killRing.peek();
    if (this.doc.killRing.length === 0 || text === undefined) return false;
    this.doc.pushUndoSnapshot();
    this.insertYankedText(text);
    this.doc.lastAction = "yank";
    return true;
  }

  yankPop(): boolean {
    if (this.doc.lastAction !== "yank" || this.doc.killRing.length <= 1) return false;
    this.doc.pushUndoSnapshot();
    this.deleteYankedText();
    this.doc.killRing.rotate();
    this.insertYankedText(this.doc.killRing.peek()!);
    this.doc.lastAction = "yank";
    return true;
  }

  private kill(text: string, prepend: boolean, accumulate: boolean): void {
    this.doc.killRing.push(text, { prepend, accumulate });
    this.doc.lastAction = "kill";
  }

  private insertYankedText(text: string): void {
    const { state } = this.doc;
    const lines = text.split("\n");
    const currentLine = this.doc.currentLine();
    const before = currentLine.slice(0, state.cursorCol);
    const after = currentLine.slice(state.cursorCol);

    if (lines.length === 1) {
      state.lines[state.cursorLine] = before + text + after;
      this.doc.setCursorCol(state.cursorCol + text.length);
    } else {
      state.lines[state.cursorLine] = before + (lines[0] || "");
      for (let i = 1; i < lines.length - 1; i++) {
        state.lines.splice(state.cursorLine + i, 0, lines[i] || "");
      }
      const lastLineIndex = state.cursorLine + lines.length - 1;
      state.lines.splice(lastLineIndex, 0, (lines[lines.length - 1] || "") + after);
      state.cursorLine = lastLineIndex;
      this.doc.setCursorCol((lines[lines.length - 1] || "").length);
    }
    this.doc.changed();
  }

  private deleteYankedText(): void {
    const yankedText = this.doc.killRing.peek();
    if (yankedText === undefined || yankedText === "") return;
    const { state } = this.doc;
    const yankLines = yankedText.split("\n");

    if (yankLines.length === 1) {
      const currentLine = this.doc.currentLine();
      const deleteLen = yankedText.length;
      state.lines[state.cursorLine] =
        currentLine.slice(0, state.cursorCol - deleteLen) + currentLine.slice(state.cursorCol);
      this.doc.setCursorCol(state.cursorCol - deleteLen);
    } else {
      const startLine = state.cursorLine - (yankLines.length - 1);
      const startCol = (state.lines[startLine] || "").length - (yankLines[0] || "").length;
      const afterCursor = this.doc.currentLine().slice(state.cursorCol);
      const beforeYank = (state.lines[startLine] || "").slice(0, startCol);
      state.lines.splice(startLine, yankLines.length, beforeYank + afterCursor);
      state.cursorLine = startLine;
      this.doc.setCursorCol(startCol);
    }
    this.doc.changed();
  }
}
