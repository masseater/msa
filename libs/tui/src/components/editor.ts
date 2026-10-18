import type { AutocompleteProvider } from "../autocomplete.ts";
import { getKeybindings, type KeybindingsManager } from "../keybindings.ts";
import type { Component, Focusable, TuiMouseEvent, TuiMouseEventResult } from "../tui-component.ts";
import type { TUI } from "../tui-interface.ts";
import { EditorAutocomplete } from "./editor-autocomplete.ts";
import { EditorCommands } from "./editor-commands.ts";
import { EditorDocument } from "./editor-document.ts";
import { insertableInput, isNewLineInput, printableInput } from "./editor-keys.ts";
import {
  clampScrollOffset,
  createScrollBorder,
  editorPadding,
  padContentLines,
  renderContentLines,
} from "./editor-render.ts";
import type { SelectListTheme } from "./select-list.ts";

export interface EditorTheme {
  borderColor: (str: string) => string;
  selectList: SelectListTheme;
}

export interface EditorOptions {
  paddingX?: number;
  autocompleteMaxVisible?: number;
}

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

function clampPadding(padding: number): number {
  return Number.isFinite(padding) ? Math.max(0, Math.floor(padding)) : 0;
}

function clampMaxVisible(maxVisible: number): number {
  return Number.isFinite(maxVisible) ? Math.max(3, Math.min(20, Math.floor(maxVisible))) : 5;
}

export class Editor implements Component, Focusable {
  focused: boolean = false;
  protected tui: TUI;
  public borderColor: (str: string) => string;
  public onSubmit?: (text: string) => void;
  public onChange?: (text: string) => void;
  public disableSubmit: boolean = false;

  private paddingX: number;
  private renderedVisibleLineCount = 1;
  private renderedAutocompleteHeight = 0;
  private pasteBuffer: string = "";
  private isInPaste: boolean = false;
  private jumpMode: "forward" | "backward" | null = null;
  private readonly doc = new EditorDocument(() => this.onChange?.(this.getText()));
  private readonly autocomplete: EditorAutocomplete;
  private readonly commands: EditorCommands;

  constructor(tui: TUI, theme: EditorTheme, options: EditorOptions = {}) {
    this.tui = tui;
    this.borderColor = theme.borderColor;
    this.paddingX = clampPadding(options.paddingX ?? 0);
    this.autocomplete = new EditorAutocomplete(this.doc, {
      theme: theme.selectList,
      maxVisible: clampMaxVisible(options.autocompleteMaxVisible ?? 5),
      requestRender: () => this.tui.requestRender(),
    });
    this.commands = new EditorCommands(this.doc, this.autocomplete, {
      terminalRows: () => this.tui.terminal.rows,
      isSubmitDisabled: () => this.disableSubmit,
      submit: (text) => {
        this.onChange?.("");
        this.onSubmit?.(text);
      },
    });
  }

  getPaddingX(): number {
    return this.paddingX;
  }

  setPaddingX(padding: number): void {
    const newPadding = clampPadding(padding);
    if (this.paddingX !== newPadding) {
      this.paddingX = newPadding;
      this.tui.requestRender();
    }
  }

  getAutocompleteMaxVisible(): number {
    return this.autocomplete.maxVisible;
  }

  setAutocompleteMaxVisible(maxVisible: number): void {
    const newMaxVisible = clampMaxVisible(maxVisible);
    if (this.autocomplete.maxVisible !== newMaxVisible) {
      this.autocomplete.maxVisible = newMaxVisible;
      this.tui.requestRender();
    }
  }

  setAutocompleteProvider(provider: AutocompleteProvider): void {
    this.autocomplete.setProvider(provider);
  }

  addToHistory(text: string): void {
    this.commands.history.add(text);
  }

  invalidate(): void {}

  protected renderTopBorder(width: number, hiddenLineCount: number): string {
    const border =
      hiddenLineCount > 0 ? createScrollBorder("↑", hiddenLineCount, width) : "─".repeat(width);
    return this.borderColor(border);
  }

  protected renderBottomBorder(width: number, hiddenLineCount: number): string {
    const border =
      hiddenLineCount > 0 ? createScrollBorder("↓", hiddenLineCount, width) : "─".repeat(width);
    return this.borderColor(border);
  }

  render(width: number): string[] {
    const padding = editorPadding(width, this.paddingX);
    this.commands.layoutWidth = Math.max(
      1,
      padding.contentWidth - (padding.paddingX === 0 ? 1 : 0),
    );
    const layoutLines = this.doc.layout(this.commands.layoutWidth);
    const maxVisibleLines = Math.max(5, Math.floor(this.tui.terminal.rows * 0.3));
    const scrollOffset = clampScrollOffset({
      layoutLines,
      scrollOffset: this.doc.scrollOffset,
      maxVisibleLines,
    });
    this.doc.scrollOffset = scrollOffset;
    const visibleLines = layoutLines.slice(scrollOffset, scrollOffset + maxVisibleLines);
    this.renderedVisibleLineCount = visibleLines.length;

    const result = [
      this.renderTopBorder(width, scrollOffset),
      ...renderContentLines(visibleLines, {
        ...padding,
        focused: this.focused,
        graphemes: (text) => this.doc.graphemes(text),
      }),
      this.renderBottomBorder(width, layoutLines.length - (scrollOffset + visibleLines.length)),
    ];
    const autocompleteLines = this.autocomplete.visibleList()?.render(padding.contentWidth) ?? [];
    this.renderedAutocompleteHeight = autocompleteLines.length;
    return [...result, ...padContentLines(autocompleteLines, padding)];
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    const list = this.autocomplete.visibleList();
    const autocompleteStartRow = this.renderedVisibleLineCount + 2;
    if (
      list !== undefined &&
      event.y >= autocompleteStartRow &&
      event.y < autocompleteStartRow + this.renderedAutocompleteHeight
    ) {
      const { paddingX, contentWidth } = editorPadding(event.width, this.paddingX);
      const result = list.handleMouse?.({
        ...event,
        x: event.x - paddingX,
        y: event.y - autocompleteStartRow,
        width: contentWidth,
        height: this.renderedAutocompleteHeight,
      });
      return result === undefined ? undefined : { ...result, focus: true };
    }

    if (event.type !== "click" || event.button !== "left") return undefined;
    if (event.y > 0 && event.y <= this.renderedVisibleLineCount) {
      const { paddingX } = editorPadding(event.width, this.paddingX);
      this.commands.click(this.doc.scrollOffset + event.y - 1, Math.max(0, event.x - paddingX));
    }
    return { handled: true, focus: true };
  }

  handleInput(data: string): void {
    const kb = getKeybindings();
    if (this.jumpMode !== null && this.handleJumpInput(data, kb)) return;
    const input = this.consumePaste(data);
    if (input === undefined || kb.matches(input, "tui.input.copy")) return;
    if (kb.matches(input, "tui.editor.undo")) {
      this.commands.undo();
      return;
    }
    if (this.autocomplete.handleKey(input, kb)) return;
    if (kb.matches(input, "tui.input.tab") && !this.autocomplete.isShowing()) {
      this.autocomplete.handleTab();
      return;
    }
    if (this.commands.runBinding(input, kb)) return;
    if (isNewLineInput(input, kb)) {
      this.commands.newLineOrSubmit(input, kb);
      return;
    }
    if (kb.matches(input, "tui.input.submit")) {
      this.commands.submitOrContinue();
      return;
    }
    if (this.commands.runMotion(input, kb)) return;
    if (kb.matches(input, "tui.editor.jumpForward")) {
      this.jumpMode = "forward";
      return;
    }
    if (kb.matches(input, "tui.editor.jumpBackward")) {
      this.jumpMode = "backward";
      return;
    }
    this.insertPrintable(input);
  }

  private handleJumpInput(data: string, kb: KeybindingsManager): boolean {
    const direction = this.jumpMode;
    this.jumpMode = null;
    if (direction === null) return false;
    if (kb.matches(data, "tui.editor.jumpForward") || kb.matches(data, "tui.editor.jumpBackward")) {
      return true;
    }
    const printable = printableInput(data);
    if (printable === undefined) return false;
    this.commands.jumpToChar(printable, direction);
    return true;
  }

  private consumePaste(data: string): string | undefined {
    let input = data;
    if (input.includes(PASTE_START)) {
      this.isInPaste = true;
      this.pasteBuffer = "";
      input = input.replace(PASTE_START, "");
    }
    if (!this.isInPaste) return input;
    this.pasteBuffer += input;
    const endIndex = this.pasteBuffer.indexOf(PASTE_END);
    if (endIndex === -1) return undefined;
    const pasteContent = this.pasteBuffer.substring(0, endIndex);
    if (pasteContent.length > 0) {
      this.commands.paste(pasteContent);
    }
    this.isInPaste = false;
    const remaining = this.pasteBuffer.substring(endIndex + PASTE_END.length);
    this.pasteBuffer = "";
    if (remaining.length > 0) {
      this.handleInput(remaining);
    }
    return undefined;
  }

  private insertPrintable(input: string): void {
    const text = insertableInput(input);
    if (text !== undefined) {
      this.commands.insertCharacter(text);
    }
  }

  getText(): string {
    return this.doc.getText();
  }

  getExpandedText(): string {
    return this.doc.expandedText();
  }

  getLines(): string[] {
    return [...this.doc.state.lines];
  }

  getCursor(): { line: number; col: number } {
    return { line: this.doc.state.cursorLine, col: this.doc.state.cursorCol };
  }

  setText(text: string): void {
    this.commands.setText(text);
  }

  insertTextAtCursor(text: string): void {
    this.commands.insertTextAtCursor(text);
  }

  public isShowingAutocomplete(): boolean {
    return this.autocomplete.isShowing();
  }
}
