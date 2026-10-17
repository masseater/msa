import { isControlCharacter } from "../ansi-sequences.ts";
import type { Keybinding } from "../keybinding-definitions.ts";
import { getKeybindings } from "../keybindings.ts";
import { decodeKittyPrintable } from "../keys.ts";
import {
  type Component,
  CURSOR_MARKER,
  type Focusable,
  renderFakeCursor,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "../tui.ts";
import { getGraphemeSegmenter, sliceByColumn, truncateToWidth, visibleWidth } from "../utils.ts";
import { InputTextField } from "./input-text-field.ts";

const segmenter = getGraphemeSegmenter();

interface InputAction {
  readonly keybinding: Keybinding;
  readonly data?: string;
  readonly run: () => void;
}

export interface InputOptions {
  prompt?: string;
  placeholder?: string;
  placeholderStyle?: (text: string) => string;
}

export class Input extends InputTextField implements Component, Focusable {
  private readonly prompt: string;
  private readonly placeholder: string;
  private readonly placeholderStyle: (text: string) => string;
  private renderedStartColumn = 0;
  public onSubmit?: (value: string) => void;
  public onEscape?: () => void;

  focused: boolean = false;

  private pasteBuffer: string = "";
  private isInPaste: boolean = false;

  constructor(options: InputOptions = {}) {
    super();
    this.prompt = options.prompt ?? "> ";
    this.placeholder = options.placeholder ?? "";
    this.placeholderStyle = options.placeholderStyle ?? ((text) => text);
  }

  private consumePaste(data: string): string | undefined {
    let rest = data;
    if (rest.includes("\x1b[200~")) {
      this.isInPaste = true;
      this.pasteBuffer = "";
      rest = rest.replace("\x1b[200~", "");
    }

    if (!this.isInPaste) return rest;

    this.pasteBuffer += rest;
    const endIndex = this.pasteBuffer.indexOf("\x1b[201~");
    if (endIndex !== -1) {
      const pasteContent = this.pasteBuffer.substring(0, endIndex);
      this.handlePaste(pasteContent);
      this.isInPaste = false;

      const remaining = this.pasteBuffer.substring(endIndex + 6);
      this.pasteBuffer = "";
      if (remaining !== "") {
        this.handleInput(remaining);
      }
    }
    return undefined;
  }

  private inputActions(): ReadonlyArray<InputAction> {
    return [
      { keybinding: "tui.select.cancel", run: () => this.onEscape?.() },
      { keybinding: "tui.editor.undo", run: () => this.undo() },
      { keybinding: "tui.input.submit", data: "\n", run: () => this.onSubmit?.(this.value) },
      { keybinding: "tui.editor.deleteCharBackward", run: () => this.handleBackspace() },
      { keybinding: "tui.editor.deleteCharForward", run: () => this.handleForwardDelete() },
      { keybinding: "tui.editor.deleteWordBackward", run: () => this.deleteWordBackwards() },
      { keybinding: "tui.editor.deleteWordForward", run: () => this.deleteWordForward() },
      { keybinding: "tui.editor.deleteToLineStart", run: () => this.deleteToLineStart() },
      { keybinding: "tui.editor.deleteToLineEnd", run: () => this.deleteToLineEnd() },
      { keybinding: "tui.editor.yank", run: () => this.yank() },
      { keybinding: "tui.editor.yankPop", run: () => this.yankPop() },
      { keybinding: "tui.editor.cursorLeft", run: () => this.moveCursorLeft() },
      { keybinding: "tui.editor.cursorRight", run: () => this.moveCursorRight() },
      { keybinding: "tui.editor.cursorLineStart", run: () => this.moveCursorToLineStart() },
      { keybinding: "tui.editor.cursorLineEnd", run: () => this.moveCursorToLineEnd() },
      { keybinding: "tui.editor.cursorWordLeft", run: () => this.moveWordBackwards() },
      { keybinding: "tui.editor.cursorWordRight", run: () => this.moveWordForwards() },
    ];
  }

  private handleKeybinding(data: string): boolean {
    const kb = getKeybindings();
    for (const action of this.inputActions()) {
      if (
        kb.matches(data, action.keybinding) ||
        (action.data !== undefined && data === action.data)
      ) {
        action.run();
        return true;
      }
    }
    return false;
  }

  private insertPrintable(data: string): void {
    const kittyPrintable = decodeKittyPrintable(data);
    if (kittyPrintable !== undefined) {
      this.insertCharacter(kittyPrintable);
      return;
    }

    const hasControlChars = [...data].some(isControlCharacter);
    if (!hasControlChars) {
      this.insertCharacter(data);
    }
  }

  handleInput(data: string): void {
    const rest = this.consumePaste(data);
    if (rest === undefined) return;
    if (this.handleKeybinding(rest)) return;
    this.insertPrintable(rest);
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type !== "press" || event.button !== "left" || event.y !== 0) return undefined;
    const visibleColumn = Math.max(0, event.x - 2);
    const targetColumn = this.renderedStartColumn + visibleColumn;
    let currentColumn = 0;
    this.cursor = this.value.length;
    for (const grapheme of segmenter.segment(this.value)) {
      const nextColumn = currentColumn + visibleWidth(grapheme.segment);
      if (targetColumn < nextColumn) {
        this.cursor = grapheme.index;
        break;
      }
      currentColumn = nextColumn;
    }
    this.lastAction = null;
    return { handled: true, focus: true };
  }

  invalidate(): void {}

  private renderPlaceholder(availableWidth: number): string[] {
    const placeholder = truncateToWidth(this.placeholder, availableWidth, "");
    const graphemes = [...segmenter.segment(placeholder)];
    const atCursor = graphemes[0]?.segment ?? " ";
    const afterCursor = placeholder.slice(atCursor.length);
    const marker = this.focused ? CURSOR_MARKER : "";
    const cursorChar = renderFakeCursor(this.placeholderStyle(atCursor));
    const textWithCursor = marker + cursorChar + this.placeholderStyle(afterCursor);
    const padding = " ".repeat(Math.max(0, availableWidth - visibleWidth(textWithCursor)));
    return [this.prompt + textWithCursor + padding];
  }

  private scrollToCursor(availableWidth: number): { visibleText: string; cursorDisplay: number } {
    const totalWidth = visibleWidth(this.value);
    if (totalWidth < availableWidth) {
      return { visibleText: this.value, cursorDisplay: this.cursor };
    }

    const scrollWidth = this.cursor === this.value.length ? availableWidth - 1 : availableWidth;
    if (scrollWidth <= 0) {
      return { visibleText: "", cursorDisplay: 0 };
    }

    const cursorCol = visibleWidth(this.value.slice(0, this.cursor));
    const halfWidth = Math.floor(scrollWidth / 2);
    let startCol: number;
    if (cursorCol < halfWidth) {
      startCol = 0;
    } else if (cursorCol > totalWidth - halfWidth) {
      startCol = Math.max(0, totalWidth - scrollWidth);
    } else {
      startCol = Math.max(0, cursorCol - halfWidth);
    }

    this.renderedStartColumn = startCol;
    const beforeCursor = sliceByColumn(
      this.value,
      startCol,
      Math.max(0, cursorCol - startCol),
      true,
    );
    return {
      visibleText: sliceByColumn(this.value, startCol, scrollWidth, true),
      cursorDisplay: beforeCursor.length,
    };
  }

  render(width: number): string[] {
    const availableWidth = width - visibleWidth(this.prompt);

    if (availableWidth <= 0) {
      return [truncateToWidth(this.prompt, width, "")];
    }

    if (this.value.length === 0 && this.placeholder !== "") {
      return this.renderPlaceholder(availableWidth);
    }

    this.renderedStartColumn = 0;
    const { visibleText, cursorDisplay } = this.scrollToCursor(availableWidth);

    const graphemes = [...segmenter.segment(visibleText.slice(cursorDisplay))];
    const beforeCursor = visibleText.slice(0, cursorDisplay);
    const atCursor = graphemes[0]?.segment ?? " ";
    const afterCursor = visibleText.slice(cursorDisplay + atCursor.length);

    const marker = this.focused ? CURSOR_MARKER : "";
    const textWithCursor = beforeCursor + marker + renderFakeCursor(atCursor) + afterCursor;
    const padding = " ".repeat(Math.max(0, availableWidth - visibleWidth(textWithCursor)));

    return [this.prompt + textWithCursor + padding];
  }
}
