import { readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";

import { getNativeClipboard } from "@msa/tui";
import * as Effect from "effect/Effect";

import { awaited, awaiting } from "../core/awaiting.ts";
import { join, randomUuid } from "../core/platform-node.ts";
import { runClipboardCommand } from "./clipboard-command.ts";
import { detectSupportedImageMimeType } from "./mime.ts";
import { loadPhoton } from "./photon.ts";
import { isWSL } from "./wsl.ts";

export type ClipboardImage = {
  bytes: Uint8Array;
  mimeType: string;
};

const SUPPORTED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

const DEFAULT_LIST_TIMEOUT_MS = 1000;
const DEFAULT_POWERSHELL_TIMEOUT_MS = 5000;
const IMAGE_COMMAND_TIMEOUT_MS = 20_000;

export function isWaylandSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env["WAYLAND_DISPLAY"]) || env["XDG_SESSION_TYPE"] === "wayland";
}

function baseMimeType(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? mimeType.toLowerCase();
}

export function extensionForImageMimeType(mimeType: string): string | null {
  switch (baseMimeType(mimeType)) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return null;
  }
}

function selectPreferredImageMimeType(mimeTypes: string[]): string | null {
  const normalized = mimeTypes
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ({ raw: t, base: baseMimeType(t) }));

  for (const preferred of SUPPORTED_IMAGE_MIME_TYPES) {
    const match = normalized.find((t) => t.base === preferred);
    if (match !== undefined) {
      return match.raw;
    }
  }

  const anyImage = normalized.find((t) => t.base.startsWith("image/"));
  return anyImage?.raw ?? null;
}

function isSupportedImageMimeType(mimeType: string): boolean {
  const base = baseMimeType(mimeType);
  return SUPPORTED_IMAGE_MIME_TYPES.some((t) => t === base);
}

function convertToPng(bytes: Uint8Array): Promise<Uint8Array | null> {
  return Effect.runPromise(
    awaiting(function* () {
      const photon = yield* awaited(loadPhoton());
      if (photon === null) {
        return null;
      }

      try {
        const image = photon.PhotonImage.new_from_byteslice(bytes);
        try {
          return image.get_bytes();
        } finally {
          image.free();
        }
      } catch {
        return null;
      }
    }),
  );
}

function readClipboardImageViaWlPaste(): Promise<ClipboardImage | null | undefined> {
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

function readClipboardImageViaPowerShell(): Promise<ClipboardImage | null> {
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
        if (result === undefined) {
          return null;
        }

        const output = result.toString("utf-8").trim();
        if (output !== "ok") {
          return null;
        }

        const bytes = readFileSync(tmpFile);
        if (bytes.length === 0) {
          return null;
        }

        return { bytes: new Uint8Array(bytes), mimeType: "image/png" };
      } catch {
        return null;
      } finally {
        try {
          unlinkSync(tmpFile);
        } catch {}
      }
    }),
  );
}

function readClipboardImageViaXclip(): Promise<ClipboardImage | null | undefined> {
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

function readClipboardImageViaNativeClipboard(): Promise<ClipboardImage | null | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      const bytes = yield* awaited(getNativeClipboard()?.getImage());
      if (bytes === undefined) return undefined;
      if (bytes?.length === undefined || bytes?.length === 0) return null;
      return { bytes, mimeType: detectSupportedImageMimeType(bytes) ?? "application/octet-stream" };
    }),
  );
}

export function readClipboardImageFromCommand(
  command: string,
  platform: NodeJS.Platform = process.platform,
): Promise<ClipboardImage | null | undefined> {
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

export function readClipboardImage(options?: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<ClipboardImage | null> {
  return Effect.runPromise(
    awaiting(function* () {
      const env = options?.env ?? process.env;
      const platform = options?.platform ?? process.platform;

      if (env["TERMUX_VERSION"] !== undefined && env["TERMUX_VERSION"] !== "") {
        return null;
      }

      let image: ClipboardImage | null | undefined;

      if (platform === "linux") {
        const wsl = isWSL(env);
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

function toSupportedImage(image: ClipboardImage): Promise<ClipboardImage | null> {
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
