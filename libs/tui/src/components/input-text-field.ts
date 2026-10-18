import { KillRing } from "../kill-ring.ts";
import { isWhitespaceChar } from "../text-boundaries.ts";
import { UndoStack } from "../undo-stack.ts";
import { getGraphemeSegmenter } from "../utils.ts";
import { findWordBackward, findWordForward } from "../word-navigation.ts";

const segmenter = getGraphemeSegmenter();

interface InputState {
  value: string;
  cursor: number;
}

export class InputTextField {
  protected value: string = "";
  protected cursor: number = 0;

  private readonly killRing = new KillRing();
  protected lastAction: "kill" | "yank" | "type-word" | null = null;

  private readonly undoStack = new UndoStack<InputState>();

  getValue(): string {
    return this.value;
  }

  setValue(value: string): void {
    this.value = value;
    this.cursor = Math.min(this.cursor, value.length);
  }

  protected moveCursorLeft(): void {
    this.lastAction = null;
    if (this.cursor === 0) return;
    const graphemes = [...segmenter.segment(this.value.slice(0, this.cursor))];
    const lastGrapheme = graphemes[graphemes.length - 1];
    this.cursor -= lastGrapheme === undefined ? 1 : lastGrapheme.segment.length;
  }

  protected moveCursorRight(): void {
    this.lastAction = null;
    if (this.cursor >= this.value.length) return;
    const graphemes = [...segmenter.segment(this.value.slice(this.cursor))];
    const firstGrapheme = graphemes[0];
    this.cursor += firstGrapheme === undefined ? 1 : firstGrapheme.segment.length;
  }

  protected moveCursorToLineStart(): void {
    this.lastAction = null;
    this.cursor = 0;
  }

  protected moveCursorToLineEnd(): void {
    this.lastAction = null;
    this.cursor = this.value.length;
  }

  protected insertCharacter(char: string): void {
    if (isWhitespaceChar(char) || this.lastAction !== "type-word") {
      this.pushUndo();
    }
    this.lastAction = "type-word";

    this.value = this.value.slice(0, this.cursor) + char + this.value.slice(this.cursor);
    this.cursor += char.length;
  }

  protected handleBackspace(): void {
    this.lastAction = null;
    if (this.cursor > 0) {
      this.pushUndo();
      const beforeCursor = this.value.slice(0, this.cursor);
      const graphemes = [...segmenter.segment(beforeCursor)];
      const lastGrapheme = graphemes[graphemes.length - 1];
      const graphemeLength = lastGrapheme === undefined ? 1 : lastGrapheme.segment.length;
      this.value =
        this.value.slice(0, this.cursor - graphemeLength) + this.value.slice(this.cursor);
      this.cursor -= graphemeLength;
    }
  }

  protected handleForwardDelete(): void {
    this.lastAction = null;
    if (this.cursor < this.value.length) {
      this.pushUndo();
      const afterCursor = this.value.slice(this.cursor);
      const graphemes = [...segmenter.segment(afterCursor)];
      const firstGrapheme = graphemes[0];
      const graphemeLength = firstGrapheme === undefined ? 1 : firstGrapheme.segment.length;
      this.value =
        this.value.slice(0, this.cursor) + this.value.slice(this.cursor + graphemeLength);
    }
  }

  protected deleteToLineStart(): void {
    if (this.cursor === 0) return;
    this.pushUndo();
    const deletedText = this.value.slice(0, this.cursor);
    this.killRing.push(deletedText, { prepend: true, accumulate: this.lastAction === "kill" });
    this.lastAction = "kill";
    this.value = this.value.slice(this.cursor);
    this.cursor = 0;
  }

  protected deleteToLineEnd(): void {
    if (this.cursor >= this.value.length) return;
    this.pushUndo();
    const deletedText = this.value.slice(this.cursor);
    this.killRing.push(deletedText, { prepend: false, accumulate: this.lastAction === "kill" });
    this.lastAction = "kill";
    this.value = this.value.slice(0, this.cursor);
  }

  protected deleteWordBackwards(): void {
    if (this.cursor === 0) return;

    const wasKill = this.lastAction === "kill";

    this.pushUndo();

    const oldCursor = this.cursor;
    this.moveWordBackwards();
    const deleteFrom = this.cursor;
    this.cursor = oldCursor;

    const deletedText = this.value.slice(deleteFrom, this.cursor);
    this.killRing.push(deletedText, { prepend: true, accumulate: wasKill });
    this.lastAction = "kill";

    this.value = this.value.slice(0, deleteFrom) + this.value.slice(this.cursor);
    this.cursor = deleteFrom;
  }

  protected deleteWordForward(): void {
    if (this.cursor >= this.value.length) return;

    const wasKill = this.lastAction === "kill";

    this.pushUndo();

    const oldCursor = this.cursor;
    this.moveWordForwards();
    const deleteTo = this.cursor;
    this.cursor = oldCursor;

    const deletedText = this.value.slice(this.cursor, deleteTo);
    this.killRing.push(deletedText, { prepend: false, accumulate: wasKill });
    this.lastAction = "kill";

    this.value = this.value.slice(0, this.cursor) + this.value.slice(deleteTo);
  }

  protected yank(): void {
    const text = this.killRing.peek();
    if (text === undefined || text === "") return;

    this.pushUndo();

    this.value = this.value.slice(0, this.cursor) + text + this.value.slice(this.cursor);
    this.cursor += text.length;
    this.lastAction = "yank";
  }

  protected yankPop(): void {
    if (this.lastAction !== "yank" || this.killRing.length <= 1) return;

    this.pushUndo();

    const prevText = this.killRing.peek() || "";
    this.value = this.value.slice(0, this.cursor - prevText.length) + this.value.slice(this.cursor);
    this.cursor -= prevText.length;

    this.killRing.rotate();
    const text = this.killRing.peek() || "";
    this.value = this.value.slice(0, this.cursor) + text + this.value.slice(this.cursor);
    this.cursor += text.length;
    this.lastAction = "yank";
  }

  protected pushUndo(): void {
    this.undoStack.push({ value: this.value, cursor: this.cursor });
  }

  protected undo(): void {
    const snapshot = this.undoStack.pop();
    if (snapshot === undefined) return;
    this.value = snapshot.value;
    this.cursor = snapshot.cursor;
    this.lastAction = null;
  }

  protected moveWordBackwards(): void {
    if (this.cursor === 0) return;
    this.lastAction = null;
    this.cursor = findWordBackward(this.value, this.cursor);
  }

  protected moveWordForwards(): void {
    if (this.cursor >= this.value.length) return;
    this.lastAction = null;
    this.cursor = findWordForward(this.value, this.cursor);
  }

  protected handlePaste(pastedText: string): void {
    this.lastAction = null;
    this.pushUndo();

    const cleanText = pastedText
      .replace(/\r\n/gu, "")
      .replace(/\r/gu, "")
      .replace(/\n/gu, "")
      .replace(/\t/gu, "    ");

    this.value = this.value.slice(0, this.cursor) + cleanText + this.value.slice(this.cursor);
    this.cursor += cleanText.length;
  }
}
