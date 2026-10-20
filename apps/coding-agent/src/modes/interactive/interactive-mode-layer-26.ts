import * as os from "node:os";

import { Effect } from "effect";

import awaitingModule from "../../core/awaiting.ts";
import nodeFs from "../../core/platform/node/fs.ts";
import clipboardImage from "../../utils/clipboard-image.ts";
import type clipboardImageTypes from "../../utils/clipboard-image.types.ts";
import clipboard from "../../utils/clipboard.ts";
import errorsModule from "../../utils/errors.ts";
import pathModule from "../path.ts";
import InteractiveModeLayer25 from "./interactive-mode-layer-25.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { extensionForImageMimeType, readClipboardImage, readClipboardImageFromCommand } =
  clipboardImage;
const { readClipboardFilePaths, readClipboardText } = clipboard;
const { toErrorMessage } = errorsModule;
const { join, randomUuid } = pathModule;

export default abstract class InteractiveModeLayer26 extends InteractiveModeLayer25 {
  protected pasteClipboardImageFromCommand(imageCommand: string): Effect.Effect<void> {
    return awaitingWith(function* () {
      this.showStatus("Reading clipboard image…");
      const image = yield* awaited(readClipboardImageFromCommand(imageCommand));
      if (image !== undefined && image !== null) this.insertClipboardImage(image);
      else if (image === null) this.showStatus("No image in the clipboard");
      else this.showError("clipboardImageCommand failed or printed no image");
    }, this);
  }

  protected pasteFromClipboard(): Effect.Effect<void> {
    return awaitingWith(function* () {
      const imageCommand = this.settingsManager.getClipboardImageCommand();
      if (imageCommand !== undefined && imageCommand !== "")
        return yield* performed(this.pasteClipboardImageFromCommand(imageCommand));
      const filePaths = yield* awaited(readClipboardFilePaths());
      if (filePaths !== null) return this.insertClipboardFilePaths(filePaths);
      const image = yield* awaited(readClipboardImage());
      if (image !== null) return this.insertClipboardImage(image);
      const text = yield* awaited(readClipboardText());
      if (text === null || text === "") return undefined;
      this.editor.insertTextAtCursor?.(text);
      this.ui.requestRender();
    }, this);
  }

  protected handleClipboardPaste(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        try {
          yield* performed(this.pasteFromClipboard());
        } catch (error) {
          this.showError(`Failed to paste from clipboard: ${toErrorMessage(error)}`);
        }
      }, this),
    );
  }

  protected insertClipboardImage(image: clipboardImageTypes.ClipboardImage): void {
    const ext = extensionForImageMimeType(image.mimeType) ?? "png";
    const filePath = join(os.tmpdir(), `msa-clipboard-${randomUuid()}.${ext}`);
    nodeFs.writeFileSync(filePath, Buffer.from(image.bytes));
    this.editor.insertTextAtCursor?.(filePath);
    this.ui.requestRender();
  }
}
