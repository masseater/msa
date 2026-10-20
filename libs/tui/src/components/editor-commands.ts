import type keybindingsTypes from "../keybindings.types.ts";
import type editorAutocompleteTypes from "./editor-autocomplete.types.ts";
import editorCommandsKit from "./editor-commands-kit.ts";
import type editorCommandsTypes from "./editor-commands.types.ts";
import type editorDocumentTypes from "./editor-document.types.ts";
import type editorHistoryTypes from "./editor-history.types.ts";
import type editorKeysTypes from "./editor-keys.types.ts";
import type editorKillTypes from "./editor-kill.types.ts";
import type editorMotionTypes from "./editor-motion.types.ts";
import editorSegments from "./editor-segments.ts";

const { EditorHistory, editorKeys, EditorKillCommands, EditorMotion, editorPaste } =
  editorCommandsKit;

const { isShiftEnterSubmit, runFirstKeyCommand } = editorKeys;
const { insertPaste } = editorPaste;
const { normalizeEditorText } = editorSegments;

export default class EditorCommands {
  layoutWidth = 80;
  readonly history: editorHistoryTypes.EditorHistory;
  private readonly doc: editorDocumentTypes.EditorDocument;
  private readonly autocomplete: editorAutocompleteTypes.EditorAutocomplete;
  private readonly motion: editorMotionTypes.EditorMotion;
  private readonly kills: editorKillTypes.EditorKillCommands;
  private readonly host: editorCommandsTypes.EditorCommandHost;
  private readonly bindings: readonly editorKeysTypes.KeyCommand[];
  private readonly motions: readonly editorKeysTypes.KeyCommand[];

  constructor(
    doc: editorDocumentTypes.EditorDocument,
    autocomplete: editorAutocompleteTypes.EditorAutocomplete,
    host: editorCommandsTypes.EditorCommandHost,
  ) {
    this.doc = doc;
    this.autocomplete = autocomplete;
    this.host = host;
    this.history = new EditorHistory(doc);
    this.motion = new EditorMotion(doc);
    this.kills = new EditorKillCommands(doc, this.motion);
    this.bindings = [
      ["tui.editor.deleteToLineEnd", () => this.edit(() => this.kills.deleteToLineEnd())],
      ["tui.editor.deleteToLineStart", () => this.edit(() => this.kills.deleteToLineStart())],
      ["tui.editor.deleteWordBackward", () => this.edit(() => this.kills.deleteWordBackward())],
      ["tui.editor.deleteWordForward", () => this.edit(() => this.kills.deleteWordForward())],
      ["tui.editor.deleteCharBackward", () => this.backspace(), "shift+backspace"],
      ["tui.editor.deleteCharForward", () => this.forwardDelete(), "shift+delete"],
      ["tui.editor.yank", () => this.yank(() => this.kills.yank())],
      ["tui.editor.yankPop", () => this.yank(() => this.kills.yankPop())],
      ["tui.editor.historyPrevious", () => this.browseHistory(-1)],
      ["tui.editor.historyNext", () => this.browseHistory(1)],
      ["tui.editor.cursorLineStart", () => this.motion.moveToLineStart()],
      ["tui.editor.cursorLineEnd", () => this.motion.moveToLineEnd()],
      ["tui.editor.cursorWordLeft", () => this.motion.moveWordBackwards()],
      ["tui.editor.cursorWordRight", () => this.motion.moveWordForwards()],
    ];
    this.motions = [
      ["tui.editor.cursorUp", () => this.cursorUp()],
      ["tui.editor.cursorDown", () => this.cursorDown()],
      ["tui.editor.cursorRight", () => this.moveCursor(0, 1)],
      ["tui.editor.cursorLeft", () => this.moveCursor(0, -1)],
      ["tui.editor.pageUp", () => this.pageScroll(-1)],
      ["tui.editor.pageDown", () => this.pageScroll(1)],
    ];
  }

  runBinding(data: string, kb: keybindingsTypes.KeybindingsManager): boolean {
    return runFirstKeyCommand(this.bindings, data, kb);
  }

  runMotion(data: string, kb: keybindingsTypes.KeybindingsManager): boolean {
    return runFirstKeyCommand(this.motions, data, kb);
  }

  undo(): void {
    this.history.exit();
    this.doc.undo();
  }

  jumpToChar(char: string, direction: "forward" | "backward"): void {
    this.motion.jumpToChar(char, direction);
  }

  insertCharacter(char: string): void {
    this.history.exit();
    this.doc.insertCharacter(char);
    this.autocomplete.afterInsert(char);
  }

  paste(pastedText: string): void {
    this.autocomplete.cancel();
    this.history.exit();
    this.doc.lastAction = null;
    this.doc.pushUndoSnapshot();
    insertPaste(this.doc, pastedText);
  }

  setText(text: string): void {
    this.autocomplete.cancel();
    this.doc.lastAction = null;
    this.history.exit();
    const normalized = normalizeEditorText(text);
    if (this.doc.getText() !== normalized) {
      this.doc.pushUndoSnapshot();
    }
    this.doc.pastes.clear();
    this.doc.pasteCounter = 0;
    this.doc.replaceText(normalized);
  }

  insertTextAtCursor(text: string): void {
    if (text === "") return;
    this.autocomplete.cancel();
    this.doc.pushUndoSnapshot();
    this.doc.lastAction = null;
    this.history.exit();
    this.doc.insertText(text);
  }

  click(visualLineIndex: number, targetColumn: number): void {
    const target = this.motion.clickTarget(this.layoutWidth, visualLineIndex, targetColumn);
    if (target === undefined) return;
    this.doc.state.cursorLine = target.line;
    this.doc.setCursorCol(target.col);
    this.doc.lastAction = null;
    this.history.exit();
    this.autocomplete.refreshIfOpen();
  }

  newLineOrSubmit(data: string, kb: keybindingsTypes.KeybindingsManager): void {
    if (this.shouldSubmitOnBackslashEnter(data, kb)) {
      this.backspace();
      this.submit();
      return;
    }
    this.addNewLine();
  }

  submitOrContinue(): void {
    if (this.host.isSubmitDisabled()) return;
    if (this.isAfterBackslash()) {
      this.backspace();
      this.addNewLine();
      return;
    }
    this.submit();
  }

  private isAfterBackslash(): boolean {
    const { cursorCol } = this.doc.state;
    return cursorCol > 0 && this.doc.currentLine()[cursorCol - 1] === "\\";
  }

  private shouldSubmitOnBackslashEnter(
    data: string,
    kb: keybindingsTypes.KeybindingsManager,
  ): boolean {
    if (this.host.isSubmitDisabled()) return false;
    return isShiftEnterSubmit(data, kb) && this.isAfterBackslash();
  }

  private submit(): void {
    this.autocomplete.cancel();
    const result = this.doc.reset();
    this.history.exit();
    this.host.submit(result);
  }

  private addNewLine(): void {
    this.autocomplete.cancel();
    this.history.exit();
    this.doc.insertNewLine();
  }

  private edit(action: () => void): void {
    this.history.exit();
    action();
  }

  private backspace(): void {
    this.history.exit();
    this.doc.deleteBackward();
    this.autocomplete.afterDeletion();
  }

  private forwardDelete(): void {
    this.history.exit();
    this.doc.deleteForward();
    this.autocomplete.afterDeletion();
  }

  private yank(action: () => boolean): void {
    if (action()) this.history.exit();
  }

  private browseHistory(direction: 1 | -1): void {
    this.autocomplete.cancel();
    this.history.navigate(direction);
  }

  private cursorUp(): void {
    const onFirstLine = this.motion.isOnFirstVisualLine(this.layoutWidth);
    if (
      onFirstLine &&
      (this.doc.isEmpty() || this.history.isBrowsing || this.doc.state.cursorCol === 0)
    ) {
      this.history.navigate(-1);
    } else if (onFirstLine) {
      this.motion.moveToLineStart();
    } else {
      this.moveCursor(-1, 0);
    }
  }

  private cursorDown(): void {
    const onLastLine = this.motion.isOnLastVisualLine(this.layoutWidth);
    if (this.history.isBrowsing && onLastLine) {
      this.history.navigate(1);
    } else if (onLastLine) {
      this.motion.moveToLineEnd();
    } else {
      this.moveCursor(1, 0);
    }
  }

  private moveCursor(deltaLine: number, deltaCol: number): void {
    this.motion.moveCursor(deltaLine, deltaCol, this.layoutWidth);
    this.autocomplete.refreshIfOpen();
  }

  private pageScroll(direction: -1 | 1): void {
    this.motion.pageScroll(direction, this.layoutWidth, this.host.terminalRows());
  }
}
