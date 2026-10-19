import { platform, tmpdir } from "node:os";

import { getNativeClipboard } from "@msa/tui";
import * as Effect from "effect/Effect";

import { awaited, awaiting } from "../core/awaiting.ts";
import { join, randomUuid } from "../core/platform-node.ts";
import { readEnv } from "../core/platform.ts";
import { runClipboardCommand } from "./clipboard-command.ts";
import { remove, writeFile } from "./node-fs.ts";
import { isWSL } from "./wsl.ts";

const MAX_OSC52_ENCODED_LENGTH = 100_000;

function isRemoteSession(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env["SSH_CONNECTION"] ||
    env["SSH_CLIENT"] ||
    env["MOSH_CONNECTION"] ||
    env["MSA_CLIPBOARD_OSC52"] === "1",
  );
}

function emitOsc52(text: string): boolean {
  const encoded = Buffer.from(text).toString("base64");
  if (encoded.length > MAX_OSC52_ENCODED_LENGTH) {
    return false;
  }
  process.stdout.write(`\x1b]52;c;${encoded}\x07`);
  return true;
}

function copyViaWindowsClipboard(text: string): Promise<boolean> {
  return Effect.runPromise(
    awaiting(function* () {
      const tmpFile = join(tmpdir(), `msa-wsl-clip-${randomUuid()}.txt`);
      try {
        yield* awaited(writeFile({ path: tmpFile, data: text, mode: 0o600 }));
        const winPath = (yield* awaited(
          runClipboardCommand("wslpath", ["-w", tmpFile], { timeoutMs: 1000 }),
        ))
          ?.toString("utf8")
          .trim();
        if (winPath === undefined || winPath === "") return false;
        const script = `Set-Clipboard -Value ([System.IO.File]::ReadAllText('${winPath.replaceAll("'", "''")}', [System.Text.Encoding]::UTF8))`;
        const result = yield* awaited(
          runClipboardCommand("powershell.exe", ["-NoProfile", "-Command", script], {
            timeoutMs: 5000,
          }),
        );
        return result !== undefined;
      } catch {
        return false;
      } finally {
        try {
          yield* awaited(remove({ path: tmpFile, force: true }));
        } catch {}
      }
    }),
  );
}

export function readClipboardText(): Promise<string | null> {
  return Effect.runPromise(
    awaiting(function* () {
      const commands: [string, string[]][] = [];

      if (readEnv("TERMUX_VERSION") !== undefined && readEnv("TERMUX_VERSION") !== "")
        commands.push(["termux-clipboard-get", []]);
      if (platform() === "linux") {
        if (readEnv("WAYLAND_DISPLAY") !== undefined && readEnv("WAYLAND_DISPLAY") !== "")
          commands.push(["wl-paste", ["--no-newline", "--type", "text"]]);
        if (readEnv("DISPLAY") !== undefined && readEnv("DISPLAY") !== "") {
          commands.push(
            ["xclip", ["-selection", "clipboard", "-out"]],
            ["xsel", ["--clipboard", "--output"]],
          );
        }
      }
      for (const [command, args] of commands) {
        const bytes = yield* awaited(runClipboardCommand(command, args, { timeoutMs: 5000 }));
        if (bytes !== undefined) return bytes.toString("utf8") || null;
      }
      try {
        return (yield* awaited(getNativeClipboard()?.getText())) || null;
      } catch {
        return null;
      }
    }),
  );
}

export function readClipboardFilePaths(): Promise<string[] | null> {
  return Effect.runPromise(
    awaiting(function* () {
      const paths = yield* awaited(getNativeClipboard()?.getFilePaths?.());
      return paths?.length !== undefined && paths?.length !== 0 ? paths : null;
    }),
  );
}

export function copyToClipboard(text: string): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      const p = platform();
      const env = process.env;
      let copied = false;

      if (p !== "linux") {
        try {
          const clipboard = getNativeClipboard();
          if (clipboard?.setText !== undefined) {
            yield* awaited(clipboard.setText(text));
            copied = true;
          }
        } catch {}
      }
      if (!copied) {
        const commands: [string, string[]][] = [];
        if (p === "darwin") commands.push(["pbcopy", []]);
        else if (p === "win32") commands.push(["clip", []]);
        else {
          if (env["TERMUX_VERSION"] !== undefined && env["TERMUX_VERSION"] !== "")
            commands.push(["termux-clipboard-set", []]);
          if (env["WAYLAND_DISPLAY"] !== undefined && env["WAYLAND_DISPLAY"] !== "")
            commands.push(["wl-copy", []]);
          if (env["DISPLAY"] !== undefined && env["DISPLAY"] !== "") {
            commands.push(
              ["xclip", ["-selection", "clipboard"]],
              ["xsel", ["--clipboard", "--input"]],
            );
          }
        }
        for (const [command, args] of commands) {
          if (
            (yield* awaited(
              runClipboardCommand(command, args, { input: text, timeoutMs: 5000 }),
            )) !== undefined
          ) {
            copied = true;
            break;
          }
        }
      }
      let osc52Emitted = false;
      if (!copied && p === "linux" && (yield* awaited(isWSL(env)))) {
        if (env["WT_SESSION"] !== undefined && env["WT_SESSION"] !== "")
          osc52Emitted = emitOsc52(text);
        copied = osc52Emitted || (yield* awaited(copyViaWindowsClipboard(text)));
      }

      const headless =
        p === "linux" &&
        (env["DISPLAY"] === undefined || env["DISPLAY"] === "") &&
        (env["WAYLAND_DISPLAY"] === undefined || env["WAYLAND_DISPLAY"] === "") &&
        (env["TERMUX_VERSION"] === undefined || env["TERMUX_VERSION"] === "");
      let oversized = false;
      if (!osc52Emitted && (isRemoteSession(env) || (!copied && headless))) {
        if (emitOsc52(text)) copied = true;
        else oversized = true;
      }
      if (copied) return;
      if (oversized) throw new Error("Clipboard unavailable: text exceeds the OSC 52 size limit");
      if (env["TERMUX_VERSION"] !== undefined && env["TERMUX_VERSION"] !== "") {
        throw new Error(
          "Clipboard unavailable: install the Termux:API app and `termux-api` package",
        );
      }
      if (p === "linux") {
        if (env["WAYLAND_DISPLAY"] !== undefined && env["WAYLAND_DISPLAY"] !== "") {
          throw new Error(
            "Clipboard unavailable: install `wl-clipboard` (`wl-copy`) or check Wayland access",
          );
        }
        if (env["DISPLAY"] !== undefined && env["DISPLAY"] !== "") {
          throw new Error("Clipboard unavailable: install `xclip` or `xsel`, or check X11 access");
        }
      }
      throw new Error("Clipboard unavailable");
    }),
  );
}
