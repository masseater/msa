import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import platformModule from "../../../core/platform/index.ts";
import nodeFs from "../../../core/platform/node/fs.ts";
import os from "../../../core/platform/node/os.ts";
import clipboardImage from "../../../utils/clipboard-image.ts";
import type clipboardImageTypes from "../../../utils/clipboard-image.types.ts";
import type InteractiveMode from "../interactive-mode.ts";

const { awaited, awaitingWith } = awaitingModule;
const { join, randomUuid } = platformModule;
const { extensionForImageMimeType, readClipboardImageFromCommand } = clipboardImage;

export default class ClipboardImages {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  pasteClipboardImageFromCommand(imageCommand: string): Effect.Effect<void> {
    return awaitingWith(function* () {
      this.mode.display.status.showStatus("Reading clipboard image…");
      const image = yield* awaited(readClipboardImageFromCommand(imageCommand));
      if (image !== undefined && image !== null) this.insertClipboardImage(image);
      else if (image === null) this.mode.display.status.showStatus("No image in the clipboard");
      else this.mode.display.status.showError("clipboardImageCommand failed or printed no image");
    }, this);
  }

  insertClipboardImage(image: clipboardImageTypes.ClipboardImage): void {
    const ext = extensionForImageMimeType(image.mimeType) ?? "png";
    const filePath = join(os.tmpdir(), `msa-clipboard-${randomUuid()}.${ext}`);
    nodeFs.writeFileSync(filePath, Buffer.from(image.bytes));
    this.mode.editor.insertTextAtCursor?.(filePath);
    this.mode.ui.requestRender();
  }
}
