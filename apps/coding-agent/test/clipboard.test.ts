import type * as OsModule from "node:os";

import { awaited, runTest, readTextFile, pathExists } from "@msa/testing";
import type { NativeClipboard } from "@msa/tui";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { copyToClipboard, readClipboardText } from "../src/utils/clipboard.ts";

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
  runTest(
    Effect.gen(function* () {
      return {
        ...(yield* awaited(vi.importActual<typeof OsModule>("node:os"))),
        platform: mocks.platform,
      };
    }),
  ),
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

describe("copyToClipboard", () => {
  test("local native success skips OSC 52 and commands", () =>
    runTest(
      Effect.gen(function* () {
        yield* awaited(copyToClipboard("hello"));
        expect(mocks.clipboard.setText).toHaveBeenCalledWith("hello");
        expect(osc52Writes).toHaveLength(0);
        expect(mocks.command).not.toHaveBeenCalled();
      }),
    ));
  test("Linux skips the native writer", () =>
    runTest(
      Effect.gen(function* () {
        mocks.platform.mockReturnValue("linux");
        vi.stubEnv("DISPLAY", ":0");
        yield* awaited(copyToClipboard("hello"));
        expect(mocks.getNativeClipboard).not.toHaveBeenCalled();
        expect(mocks.command).toHaveBeenCalledWith("xclip", ["-selection", "clipboard"], {
          input: "hello",
          timeoutMs: 5000,
        });
      }),
    ));
  test("waits for the native write before emitting remote OSC 52", () =>
    runTest(
      Effect.gen(function* () {
        vi.stubEnv("SSH_CONNECTION", "client server");
        let complete = () => {};
        mocks.clipboard.setText.mockReturnValue(
          new Promise<void>((resolve) => {
            complete = resolve;
          }),
        );
        const copy = copyToClipboard("hello");
        expect(osc52Writes).toHaveLength(0);
        complete();
        yield* awaited(copy);
        expect(osc52Writes).toHaveLength(1);
        expect(mocks.command).not.toHaveBeenCalled();
      }),
    ));
  test.each([
    ["darwin", undefined],
    ["win32", undefined],
    ["linux", ":99"],
  ] as const)(
    "MSA_CLIPBOARD_OSC52=1 emits OSC 52 after a successful %s copy",
    (platform, display) =>
      runTest(
        Effect.gen(function* () {
          mocks.platform.mockReturnValue(platform);
          if (display) vi.stubEnv("DISPLAY", display);
          vi.stubEnv("MSA_CLIPBOARD_OSC52", "1");
          yield* awaited(copyToClipboard("hello"));
          if (platform === "linux") {
            expect(mocks.command).toHaveBeenCalledWith("xclip", ["-selection", "clipboard"], {
              input: "hello",
              timeoutMs: 5000,
            });
          } else {
            expect(mocks.clipboard.setText).toHaveBeenCalledWith("hello");
          }
          expect(osc52Writes).toEqual([`\x1b]52;c;${Buffer.from("hello").toString("base64")}\x07`]);
        }),
      ),
  );
  test("a rejected native write falls back to pbcopy", () =>
    runTest(
      Effect.gen(function* () {
        mocks.clipboard.setText.mockRejectedValue(new Error("native failed"));
        yield* awaited(copyToClipboard("hello"));
        expect(mocks.command).toHaveBeenCalledWith("pbcopy", [], {
          input: "hello",
          timeoutMs: 5000,
        });
        expect(osc52Writes).toHaveLength(0);
      }),
    ));
  test("a read-only native clipboard uses the command writer", () =>
    runTest(
      Effect.gen(function* () {
        mocks.getNativeClipboard.mockReturnValue({
          getText: mocks.clipboard.getText,
          getImage: mocks.clipboard.getImage,
        });
        yield* awaited(copyToClipboard("hello"));
        expect(mocks.command).toHaveBeenCalledOnce();
      }),
    ));
  test("tries xclip and xsel after wl-copy fails", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        mocks.platform.mockReturnValue("linux");
        vi.stubEnv("WAYLAND_DISPLAY", "wayland-0");
        vi.stubEnv("DISPLAY", ":0");
        mocks.command.mockImplementation((name) =>
          effectRunPromise(awaited(name === "xsel" ? Buffer.alloc(0) : undefined)),
        );
        yield* awaited(copyToClipboard("hello"));
        expect(mocks.command.mock.calls.map(([name]) => name)).toEqual([
          "wl-copy",
          "xclip",
          "xsel",
        ]);
        expect(osc52Writes).toHaveLength(0);
      }),
    ));
  test("local Linux failure does not report an unverified OSC 52 write as success", () =>
    runTest(
      Effect.gen(function* () {
        mocks.platform.mockReturnValue("linux");
        vi.stubEnv("DISPLAY", ":0");
        mocks.command.mockResolvedValue(undefined);
        yield* awaited(
          expect(copyToClipboard("hello")).rejects.toThrow(
            "Clipboard unavailable: install `xclip` or `xsel`, or check X11 access",
          ),
        );
        expect(mocks.command.mock.calls.map(([name]) => name)).toEqual(["xclip", "xsel"]);
        expect(osc52Writes).toHaveLength(0);
      }),
    ));
  test("display-less Linux falls back to OSC 52", () =>
    runTest(
      Effect.gen(function* () {
        mocks.platform.mockReturnValue("linux");
        yield* awaited(copyToClipboard("hello"));
        expect(mocks.command).not.toHaveBeenCalled();
        expect(osc52Writes).toHaveLength(1);
      }),
    ));
  test("WSL without a display writes the Windows clipboard through PowerShell", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        mocks.platform.mockReturnValue("linux");
        vi.stubEnv("WSL_DISTRO_NAME", "Ubuntu");
        let written: string | undefined;
        mocks.command.mockImplementation((name, args) =>
          effectRunPromise(
            Effect.gen(function* () {
              if (name !== "wslpath") return yield* awaited(Buffer.alloc(0));
              written = yield* readTextFile(args[1]!);
              return yield* awaited(Buffer.from("\\\\wsl.localhost\\Ubuntu\\tmp\\clip.txt\n"));
            }),
          ),
        );
        yield* awaited(copyToClipboard("héllo"));
        expect(mocks.command.mock.calls.map(([name]) => name)).toEqual([
          "wslpath",
          "powershell.exe",
        ]);
        expect(written).toBe("héllo");
        const [, wslpathArgs] = mocks.command.mock.calls[0]!;
        expect(yield* pathExists(wslpathArgs[1]!)).toBe(false);
        const [, powershellArgs] = mocks.command.mock.calls[1]!;
        expect(powershellArgs[2]).toContain("Set-Clipboard");
        expect(powershellArgs[2]).toContain("'\\\\wsl.localhost\\Ubuntu\\tmp\\clip.txt'");
        expect(osc52Writes).toHaveLength(0);
      }),
    ));
  test("WSL falls back to OSC 52 when Windows interop is unavailable", () =>
    runTest(
      Effect.gen(function* () {
        mocks.platform.mockReturnValue("linux");
        vi.stubEnv("WSL_DISTRO_NAME", "Ubuntu");
        mocks.command.mockResolvedValue(undefined);
        yield* awaited(copyToClipboard("hello"));
        expect(mocks.command.mock.calls.map(([name]) => name)).toEqual(["wslpath"]);
        expect(osc52Writes).toHaveLength(1);
      }),
    ));
  test("WSL in Windows Terminal prefers OSC 52 over PowerShell", () =>
    runTest(
      Effect.gen(function* () {
        mocks.platform.mockReturnValue("linux");
        vi.stubEnv("WSL_DISTRO_NAME", "Ubuntu");
        vi.stubEnv("WT_SESSION", "session");
        yield* awaited(copyToClipboard("hello"));
        expect(mocks.command).not.toHaveBeenCalled();
        expect(osc52Writes).toHaveLength(1);
      }),
    ));
  test("WSL in Windows Terminal emits OSC 52 once in a remote session", () =>
    runTest(
      Effect.gen(function* () {
        mocks.platform.mockReturnValue("linux");
        vi.stubEnv("WSL_DISTRO_NAME", "Ubuntu");
        vi.stubEnv("WT_SESSION", "session");
        vi.stubEnv("SSH_CONNECTION", "client server");
        yield* awaited(copyToClipboard("hello"));
        expect(mocks.command).not.toHaveBeenCalled();
        expect(osc52Writes).toHaveLength(1);
      }),
    ));
  test("WSL in Windows Terminal uses PowerShell for oversized OSC 52 payloads", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        mocks.platform.mockReturnValue("linux");
        vi.stubEnv("WSL_DISTRO_NAME", "Ubuntu");
        vi.stubEnv("WT_SESSION", "session");
        mocks.command.mockImplementation((name) =>
          effectRunPromise(
            awaited(name === "wslpath" ? Buffer.from("C:\\clip.txt") : Buffer.alloc(0)),
          ),
        );
        yield* awaited(copyToClipboard("x".repeat(80_000)));
        expect(mocks.command.mock.calls.map(([name]) => name)).toEqual([
          "wslpath",
          "powershell.exe",
        ]);
        expect(osc52Writes).toHaveLength(0);
      }),
    ));
  test("WSL with a display prefers the Linux clipboard tools", () =>
    runTest(
      Effect.gen(function* () {
        mocks.platform.mockReturnValue("linux");
        vi.stubEnv("WSL_DISTRO_NAME", "Ubuntu");
        vi.stubEnv("WAYLAND_DISPLAY", "wayland-0");
        yield* awaited(copyToClipboard("hello"));
        expect(mocks.command.mock.calls.map(([name]) => name)).toEqual(["wl-copy"]);
        expect(osc52Writes).toHaveLength(0);
      }),
    ));
  test("reports the Wayland clipboard tool instead of the X11 fallback", () =>
    runTest(
      Effect.gen(function* () {
        mocks.platform.mockReturnValue("linux");
        vi.stubEnv("WAYLAND_DISPLAY", "wayland-0");
        vi.stubEnv("DISPLAY", ":0");
        mocks.command.mockResolvedValue(undefined);
        yield* awaited(
          expect(copyToClipboard("hello")).rejects.toThrow(
            "Clipboard unavailable: install `wl-clipboard` (`wl-copy`) or check Wayland access",
          ),
        );
        expect(mocks.command.mock.calls.map(([name]) => name)).toEqual([
          "wl-copy",
          "xclip",
          "xsel",
        ]);
      }),
    ));
  test("Termux on Android writes through termux-clipboard-set", () =>
    runTest(
      Effect.gen(function* () {
        mocks.platform.mockReturnValue("android");
        vi.stubEnv("TERMUX_VERSION", "0.119");
        mocks.getNativeClipboard.mockReturnValue(undefined);
        yield* awaited(copyToClipboard("hello"));
        expect(mocks.command).toHaveBeenCalledExactlyOnceWith("termux-clipboard-set", [], {
          input: "hello",
          timeoutMs: 5000,
        });
        expect(osc52Writes).toHaveLength(0);
      }),
    ));
  test("reports the Termux:API requirement on Android", () =>
    runTest(
      Effect.gen(function* () {
        mocks.platform.mockReturnValue("android");
        vi.stubEnv("TERMUX_VERSION", "0.119");
        mocks.getNativeClipboard.mockReturnValue(undefined);
        mocks.command.mockResolvedValue(undefined);
        yield* awaited(
          expect(copyToClipboard("hello")).rejects.toThrow(
            "Clipboard unavailable: install the Termux:API app and `termux-api` package",
          ),
        );
      }),
    ));
  test("uses OSC 52 when native and command writes fail in a remote session", () =>
    runTest(
      Effect.gen(function* () {
        vi.stubEnv("SSH_CONNECTION", "client server");
        mocks.clipboard.setText.mockRejectedValue(new Error("native failed"));
        mocks.command.mockResolvedValue(undefined);
        yield* awaited(copyToClipboard("hello"));
        expect(osc52Writes).toHaveLength(1);
      }),
    ));
  test("does not emit oversized OSC 52 payloads", () =>
    runTest(
      Effect.gen(function* () {
        vi.stubEnv("SSH_CONNECTION", "client server");
        mocks.clipboard.setText.mockRejectedValue(new Error("native failed"));
        mocks.command.mockResolvedValue(undefined);
        yield* awaited(
          expect(copyToClipboard("x".repeat(80_000))).rejects.toThrow(
            "Clipboard unavailable: text exceeds the OSC 52 size limit",
          ),
        );
        expect(osc52Writes).toHaveLength(0);
      }),
    ));
});
