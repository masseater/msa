import tui from "@msa/tui";
import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import platform from "../../core/platform/index.ts";
import nodeOs from "../../core/platform/node/os.ts";
import clipboardCommand from "../clipboard-command.ts";
import type clipboardImageTypes from "../clipboard-image.types.ts";
import mime from "../mime.ts";
import imageMime from "./image-mime.ts";

const { tmpdir } = nodeOs;

const { detectSupportedImageMimeType } = mime;
const { getNativeClipboard } = tui;
const { remove, readFile } = platform.files;
const { join, randomUuid } = platform;
const { runClipboardCommand } = clipboardCommand;
const { awaited, awaiting } = awaitingModule;
const { baseMimeType, selectPreferredImageMimeType } = imageMime;

const DEFAULT_LIST_TIMEOUT_MS = 1000;

const DEFAULT_POWERSHELL_TIMEOUT_MS = 5000;

function isWaylandSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env["WAYLAND_DISPLAY"]) || env["XDG_SESSION_TYPE"] === "wayland";
}

function readClipboardImageViaWlPaste(): Promise<
  clipboardImageTypes.ClipboardImage | null | undefined
> {
  return Effect.runPromise(
    awaiting(function* () {
      const list = yield* awaited(
        runClipboardCommand("wl-paste", ["--list-types"], {
          timeoutMs: DEFAULT_LIST_TIMEOUT_MS,
        }),
      );
      if (list === undefined) return undefined;

      const types = list
        .toString("utf-8")
        .split(/\r?\n/u)
        .map((t) => t.trim())
        .filter(Boolean);

      const selectedType = selectPreferredImageMimeType(types);
      if (selectedType === null || selectedType === "") {
        return null;
      }

      const data = yield* awaited(
        runClipboardCommand("wl-paste", ["--type", selectedType, "--no-newline"]),
      );
      if (data === undefined) return undefined;
      if (data.length === 0) return null;

      return { bytes: data, mimeType: baseMimeType(selectedType) };
    }),
  );
}

function readClipboardImageViaPowerShell(): Promise<clipboardImageTypes.ClipboardImage | null> {
  return Effect.runPromise(
    awaiting(function* () {
      const tmpFile = join(tmpdir(), `msa-wsl-clip-${randomUuid()}.png`);

      try {
        const winPathResult = yield* awaited(
          runClipboardCommand("wslpath", ["-w", tmpFile], {
            timeoutMs: DEFAULT_LIST_TIMEOUT_MS,
          }),
        );
        if (winPathResult === undefined) {
          return null;
        }

        const winPath = winPathResult.toString("utf-8").trim();
        if (winPath === "") {
          return null;
        }

        const psQuotedWinPath = winPath.replaceAll("'", "''");
        const result = yield* saveClipboardImageWithPowerShell(psQuotedWinPath);
        if (result === undefined) {
          return null;
        }

        const output = result.toString("utf-8").trim();
        if (output !== "ok") {
          return null;
        }

        const bytes = yield* awaited(readFile(tmpFile));
        if (bytes.length === 0) {
          return null;
        }

        return { bytes: new Uint8Array(bytes), mimeType: "image/png" };
      } catch {
        return null;
      } finally {
        try {
          yield* awaited(remove({ force: true, path: tmpFile }));
        } catch {}
      }
    }),
  );
}

function* saveClipboardImageWithPowerShell(psQuotedWinPath: string) {
  const psScript = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    `$path = '${psQuotedWinPath}'`,
    "$img = [System.Windows.Forms.Clipboard]::GetImage()",
    "if ($img) { $img.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); Write-Output 'ok' } else { Write-Output 'empty' }",
  ].join("; ");

  const result = yield* awaited(
    runClipboardCommand("powershell.exe", ["-NoProfile", "-Command", psScript], {
      timeoutMs: DEFAULT_POWERSHELL_TIMEOUT_MS,
    }),
  );
  return result;
}

function readClipboardImageViaXclip(): Promise<
  clipboardImageTypes.ClipboardImage | null | undefined
> {
  return Effect.runPromise(
    awaiting(function* () {
      const targets = yield* awaited(
        runClipboardCommand("xclip", ["-selection", "clipboard", "-t", "TARGETS", "-o"], {
          timeoutMs: DEFAULT_LIST_TIMEOUT_MS,
        }),
      );

      if (targets === undefined) return undefined;

      const candidateTypes = targets
        .toString("utf-8")
        .split(/\r?\n/u)
        .map((t) => t.trim())
        .filter(Boolean);
      const preferred = selectPreferredImageMimeType(candidateTypes);
      if (preferred === null || preferred === "") return null;

      const data = yield* awaited(
        runClipboardCommand("xclip", ["-selection", "clipboard", "-t", preferred, "-o"]),
      );
      if (data === undefined) return undefined;
      if (data.length === 0) return null;
      return { bytes: data, mimeType: baseMimeType(preferred) };
    }),
  );
}

function readClipboardImageViaNativeClipboard(): Promise<
  clipboardImageTypes.ClipboardImage | null | undefined
> {
  return Effect.runPromise(
    awaiting(function* () {
      const bytes = yield* awaited(getNativeClipboard()?.getImage());
      if (bytes === undefined) return undefined;
      if (bytes?.length === undefined || bytes?.length === 0) return null;
      return { bytes, mimeType: detectSupportedImageMimeType(bytes) ?? "application/octet-stream" };
    }),
  );
}

const clipboardReaders = {
  isWaylandSession,
  readClipboardImageViaNativeClipboard,
  readClipboardImageViaPowerShell,
  readClipboardImageViaWlPaste,
  readClipboardImageViaXclip,
};

export default clipboardReaders;
