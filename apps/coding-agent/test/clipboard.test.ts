import { awaited, runTest } from "@msa/testing";
import type { NativeClipboard } from "@msa/tui";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { readClipboardText } from "../src/utils/clipboard.ts";

const mocks = vi.hoisted(() => ({
  clipboard: {
    getText: vi.fn<NativeClipboard["getText"]>(),
    getImage: vi.fn<NativeClipboard["getImage"]>(),
    setText: vi.fn<(text: string) => Promise<void>>(),
  },
  getNativeClipboard: vi.fn<() => NativeClipboard | undefined>(),
  command:
    vi.fn<
      (
        command: string,
        args: readonly string[],
        options?: { input?: string; timeoutMs?: number },
      ) => Promise<Buffer | undefined>
    >(),
  platform: vi.fn<() => NodeJS.Platform>(),
}));
vi.mock("@msa/tui", () => ({ getNativeClipboard: mocks.getNativeClipboard }));
vi.mock("../src/utils/clipboard-command.ts", () => ({ runClipboardCommand: mocks.command }));
vi.mock("node:os", () =>
  import("node:os").then((actual) => ({
    ...actual,
    platform: mocks.platform,
  })),
);

let originalWrite: typeof process.stdout.write;
let osc52Writes: string[];
beforeEach(() => {
  vi.resetAllMocks();
  for (const name of [
    "SSH_CONNECTION",
    "SSH_CLIENT",
    "MOSH_CONNECTION",
    "WAYLAND_DISPLAY",
    "DISPLAY",
    "TERMUX_VERSION",
    "WT_SESSION",
    "WSL_DISTRO_NAME",
    "WSLENV",
    "MSA_CLIPBOARD_OSC52",
  ])
    vi.stubEnv(name, "");
  mocks.platform.mockReturnValue("darwin");
  mocks.getNativeClipboard.mockReturnValue(mocks.clipboard);
  mocks.clipboard.getText.mockResolvedValue(null);
  mocks.clipboard.setText.mockResolvedValue();
  mocks.command.mockResolvedValue(Buffer.alloc(0));
  osc52Writes = [];
  originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((...args: Parameters<typeof process.stdout.write>) => {
    const [chunk] = args;
    if (typeof chunk === "string" && chunk.startsWith("\x1b]52;c;")) {
      osc52Writes.push(chunk);
      return true;
    }
    return originalWrite(...args);
  }) as typeof process.stdout.write;
});
afterEach(() => {
  process.stdout.write = originalWrite;
  vi.unstubAllEnvs();
});

describe("readClipboardText", () => {
  test("awaits native clipboard text and catches rejected reads", () =>
    runTest(
      Effect.gen(function* () {
        mocks.clipboard.getText.mockResolvedValue("clipboard text");
        yield* awaited(expect(readClipboardText()).resolves.toBe("clipboard text"));
        mocks.clipboard.getText.mockRejectedValue(new Error("clipboard unavailable"));
        yield* awaited(expect(readClipboardText()).resolves.toBeNull());
      }),
    ));
  for (const [env, command, args, calls] of [
    ["WAYLAND_DISPLAY", "wl-paste", ["--no-newline", "--type", "text"], ["wl-paste"]],
    ["DISPLAY", "xclip", ["-selection", "clipboard", "-out"], ["xclip"]],
    ["DISPLAY", "xsel", ["--clipboard", "--output"], ["xclip", "xsel"]],
  ] as const) {
    test.each(["clipboard text", ""])(`${command} result %j stops fallback`, (text) =>
      runTest(
        Effect.gen(function* () {
          const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          mocks.platform.mockReturnValue("linux");
          vi.stubEnv("DISPLAY", ":0");
          vi.stubEnv(env, "1");
          mocks.command.mockImplementation((name) =>
            effectRunPromise(awaited(name === command ? Buffer.from(text) : undefined)),
          );
          yield* awaited(expect(readClipboardText()).resolves.toBe(text || null));
          expect(mocks.command.mock.calls.map(([name]) => name)).toEqual(calls);
          expect(mocks.command).toHaveBeenLastCalledWith(command, args, { timeoutMs: 5000 });
          expect(mocks.getNativeClipboard).not.toHaveBeenCalled();
        }),
      ),
    );
  }
  test.each(["native text", "", null, undefined])(
    "uses native X11 after command failures: %j",
    (text) =>
      runTest(
        Effect.gen(function* () {
          mocks.platform.mockReturnValue("linux");
          vi.stubEnv("DISPLAY", ":0");
          vi.stubEnv("WAYLAND_DISPLAY", "wayland-0");
          mocks.command.mockResolvedValue(undefined);
          mocks.clipboard.getText.mockResolvedValue(text);
          yield* awaited(expect(readClipboardText()).resolves.toBe(text || null));
          expect(mocks.getNativeClipboard).toHaveBeenCalledExactlyOnceWith();
          expect(mocks.command.mock.calls.map(([name]) => name)).toEqual([
            "wl-paste",
            "xclip",
            "xsel",
          ]);
        }),
      ),
  );
  test.each(["clipboard text", ""])(
    "Termux reads termux-clipboard-get result %j on Android",
    (text) =>
      runTest(
        Effect.gen(function* () {
          mocks.platform.mockReturnValue("android");
          vi.stubEnv("TERMUX_VERSION", "0.119");
          mocks.command.mockResolvedValue(Buffer.from(text));
          yield* awaited(expect(readClipboardText()).resolves.toBe(text || null));
          expect(mocks.command).toHaveBeenCalledExactlyOnceWith("termux-clipboard-get", [], {
            timeoutMs: 5000,
          });
          expect(mocks.getNativeClipboard).not.toHaveBeenCalled();
        }),
      ),
  );
  test("falls back to X11 tools when wl-paste is unavailable", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        mocks.platform.mockReturnValue("linux");
        vi.stubEnv("WAYLAND_DISPLAY", "wayland-0");
        vi.stubEnv("DISPLAY", ":0");
        mocks.command.mockImplementation((name) =>
          effectRunPromise(awaited(name === "wl-paste" ? undefined : Buffer.from("X11 text"))),
        );
        yield* awaited(expect(readClipboardText()).resolves.toBe("X11 text"));
        expect(mocks.getNativeClipboard).not.toHaveBeenCalled();
      }),
    ));
});
