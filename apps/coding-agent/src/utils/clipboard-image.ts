import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import awaitingModule from "../core/awaiting.ts";
import clipboardCommand from "./clipboard-command.ts";
import type clipboardImageTypes from "./clipboard-image.types.ts";
import clipboardReaders from "./clipboard-image/clipboard-readers.ts";
import imageMime from "./clipboard-image/image-mime.ts";
import mime from "./mime.ts";
import wslModule from "./wsl.ts";

const { isWSL } = wslModule;
const { detectSupportedImageMimeType } = mime;
const { runClipboardCommand } = clipboardCommand;
const { awaited, awaiting } = awaitingModule;
const { convertToPng, isSupportedImageMimeType, extensionForImageMimeType } = imageMime;
const {
  readClipboardImageViaNativeClipboard,
  readClipboardImageViaPowerShell,
  readClipboardImageViaXclip,
  readClipboardImageViaWlPaste,
  isWaylandSession,
} = clipboardReaders;

const IMAGE_COMMAND_TIMEOUT_MS = 20_000;

function readClipboardImageFromCommandImpl(
  command: string,
  platform: NodeJS.Platform = process.platform,
): Promise<clipboardImageTypes.ClipboardImage | null | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      const bytes =
        platform === "win32"
          ? yield* awaited(
              runClipboardCommand("cmd.exe", ["/d", "/s", "/c", command], {
                timeoutMs: IMAGE_COMMAND_TIMEOUT_MS,
              }),
            )
          : yield* awaited(
              runClipboardCommand("/bin/sh", ["-c", command], {
                timeoutMs: IMAGE_COMMAND_TIMEOUT_MS,
              }),
            );
      if (bytes === undefined) return undefined;
      if (bytes.length === 0) return null;
      const image = yield* awaited(
        toSupportedImage({
          bytes: new Uint8Array(bytes),
          mimeType: detectSupportedImageMimeType(bytes) ?? "application/octet-stream",
        }),
      );
      return image ?? undefined;
    }),
  );
}

const readClipboardImageFromCommand: {
  (
    command: string,
    platform?: NodeJS.Platform,
  ): Promise<clipboardImageTypes.ClipboardImage | null | undefined>;
  (
    platform?: NodeJS.Platform,
  ): (command: string) => Promise<clipboardImageTypes.ClipboardImage | null | undefined>;
} = dual((args: IArguments) => args.length >= 1, readClipboardImageFromCommandImpl);

function readClipboardImage(options?: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<clipboardImageTypes.ClipboardImage | null> {
  return Effect.runPromise(
    awaiting(function* () {
      const env = options?.env ?? process.env;
      const platform = options?.platform ?? process.platform;

      if (env["TERMUX_VERSION"] !== undefined && env["TERMUX_VERSION"] !== "") {
        return null;
      }

      let image: clipboardImageTypes.ClipboardImage | null | undefined;

      if (platform === "linux") {
        const wsl = yield* awaited(isWSL(env));
        if (isWaylandSession(env) || wsl) {
          image = yield* awaited(readClipboardImageViaWlPaste());
        }
        if (image === undefined) image = yield* awaited(readClipboardImageViaXclip());

        if ((image === undefined || image === null) && wsl)
          image = (yield* awaited(readClipboardImageViaPowerShell())) ?? image;
        if (image === undefined) image = yield* awaited(readClipboardImageViaNativeClipboard());
      } else {
        image = yield* awaited(readClipboardImageViaNativeClipboard());
      }

      return yield* awaited(image !== undefined && image !== null ? toSupportedImage(image) : null);
    }),
  );
}

function toSupportedImage(
  image: clipboardImageTypes.ClipboardImage,
): Promise<clipboardImageTypes.ClipboardImage | null> {
  return Effect.runPromise(
    awaiting(function* () {
      if (!isSupportedImageMimeType(image.mimeType)) {
        const pngBytes = yield* awaited(convertToPng(image.bytes));
        if (pngBytes === null) {
          return null;
        }
        return { bytes: pngBytes, mimeType: "image/png" };
      }

      return image;
    }),
  );
}

const clipboardImage = {
  extensionForImageMimeType,
  isWaylandSession,
  readClipboardImage,
  readClipboardImageFromCommand,
};

export default clipboardImage;
