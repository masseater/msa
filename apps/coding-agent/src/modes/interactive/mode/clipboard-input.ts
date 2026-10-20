import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import clipboardImage from "../../../utils/clipboard-image.ts";
import clipboard from "../../../utils/clipboard.ts";
import errorsModule from "../../../utils/errors.ts";
import interactiveModeSupport from "../interactive-mode-support.ts";
import type InteractiveMode from "../interactive-mode.ts";

const { quoteIfNeeded } = interactiveModeSupport;
const { awaited, awaitingWith, performed } = awaitingModule;
const { readClipboardText, readClipboardFilePaths } = clipboard;
const { toErrorMessage } = errorsModule;
const { readClipboardImage } = clipboardImage;

export default class ClipboardInput {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  private insertClipboardFilePaths(filePaths: string[]): void {
    if (filePaths.some((filePath) => /\p{Cc}/u.test(filePath)))
      throw new Error("Clipboard file path contains control characters");
    const paths = this.mode.input.bash.isBashMode
      ? filePaths.map(quoteIfNeeded).join(" ")
      : filePaths.join("\n");
    const cursor = this.mode.editor.getCursor?.();
    const currentLine =
      cursor === undefined ? "" : (this.mode.editor.getText().split("\n")[cursor.line] ?? "");
    const before = cursor !== undefined && cursor.col > 0 ? currentLine[cursor.col - 1] : "";
    const after = cursor === undefined ? "" : currentLine[cursor.col];
    const needsSpace = (character: string | undefined) =>
      character !== undefined && character !== "" && !/\s/u.test(character);
    const leadingSpace = needsSpace(before) ? " " : "";
    const trailingSpace = needsSpace(after) ? " " : "";
    this.mode.editor.insertTextAtCursor?.(`${leadingSpace}${paths}${trailingSpace}`);
    this.mode.ui.requestRender();
  }

  readonly onRightClickPaste = (): void => {
    void void this.handleRightClickPaste();
  };

  handleRightClickPaste(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const target = this.mode.lifecycle.screen.renderer.getFocusedComponent();
        const handleInput = target?.handleInput;
        if (target === null || handleInput === undefined) return;
        try {
          const text = yield* awaited(readClipboardText());
          if (
            text === null ||
            text === "" ||
            this.mode.lifecycle.screen.renderer.getFocusedComponent() !== target
          )
            return;
          handleInput.call(target, `\x1b[200~${text}\x1b[201~`);
          this.mode.ui.requestRender();
        } catch {}
      }, this),
    );
  }

  private pasteFromClipboard(): Effect.Effect<void> {
    return awaitingWith(function* () {
      const imageCommand = this.mode.settingsManager.terminal.getClipboardImageCommand();
      if (imageCommand !== undefined && imageCommand !== "")
        return yield* performed(
          this.mode.input.clipboardImages.pasteClipboardImageFromCommand(imageCommand),
        );
      const filePaths = yield* awaited(readClipboardFilePaths());
      if (filePaths !== null) return this.insertClipboardFilePaths(filePaths);
      const image = yield* awaited(readClipboardImage());
      if (image !== null) return this.mode.input.clipboardImages.insertClipboardImage(image);
      const text = yield* awaited(readClipboardText());
      if (text === null || text === "") return undefined;
      this.mode.editor.insertTextAtCursor?.(text);
      this.mode.ui.requestRender();
    }, this);
  }

  handleClipboardPaste(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        try {
          yield* performed(this.pasteFromClipboard());
        } catch (error) {
          this.mode.display.status.showError(
            `Failed to paste from clipboard: ${toErrorMessage(error)}`,
          );
        }
      }, this),
    );
  }
}
