import testing from "@msa/testing";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import clipboardModule from "../src/utils/clipboard.ts";

const { copyToClipboard } = clipboardModule;

const { awaited, pathExists, readTextFile, runTest } = testing;

const mocks = vi.hoisted(() => ({
  clipboard: {
    getImage: vi.fn<tuiTypes.NativeClipboard["getImage"]>(),
    getText: vi.fn<tuiTypes.NativeClipboard["getText"]>(),
    setText: vi.fn<(text: string) => Promise<void>>(),
  },
  command:
    vi.fn<
      (
        command: string,
        args: readonly string[],
        options?: { input?: string; timeoutMs?: number },
      ) => Promise<Buffer | undefined>
    >(),
  getNativeClipboard: vi.fn<() => tuiTypes.NativeClipboard | undefined>(),
  platform: vi.fn<() => NodeJS.Platform>(),
}));
vi.mock("@msa/tui", () => ({ default: { getNativeClipboard: mocks.getNativeClipboard } }));
vi.mock("../src/utils/clipboard-command.ts", () => ({
  default: { runClipboardCommand: mocks.command },
}));
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

const wslWithoutADisplayWritesTheWindows = () =>
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
      expect(mocks.command.mock.calls.map(([name]) => name)).toEqual(["wslpath", "powershell.exe"]);
      expect(written).toBe("héllo");
      const [, wslpathArgs] = mocks.command.mock.calls[0]!;
      expect(yield* pathExists(wslpathArgs[1]!)).toBe(false);
      const [, powershellArgs] = mocks.command.mock.calls[1]!;
      expect(powershellArgs[2]).toContain("Set-Clipboard");
      expect(powershellArgs[2]).toContain("'\\\\wsl.localhost\\Ubuntu\\tmp\\clip.txt'");
      expect(osc52Writes).toHaveLength(0);
    }),
  );

const wslFallsBackToOsc52When = () =>
  runTest(
    Effect.gen(function* () {
      mocks.platform.mockReturnValue("linux");
      vi.stubEnv("WSL_DISTRO_NAME", "Ubuntu");
      mocks.command.mockResolvedValue(undefined);
      yield* awaited(copyToClipboard("hello"));
      expect(mocks.command.mock.calls.map(([name]) => name)).toEqual(["wslpath"]);
      expect(osc52Writes).toHaveLength(1);
    }),
  );

const wslInWindowsTerminalPrefersOsc52 = () =>
  runTest(
    Effect.gen(function* () {
      mocks.platform.mockReturnValue("linux");
      vi.stubEnv("WSL_DISTRO_NAME", "Ubuntu");
      vi.stubEnv("WT_SESSION", "session");
      yield* awaited(copyToClipboard("hello"));
      expect(mocks.command).not.toHaveBeenCalled();
      expect(osc52Writes).toHaveLength(1);
    }),
  );

const wslInWindowsTerminalEmitsOsc52 = () =>
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
  );

const wslInWindowsTerminalUsesPowershellFor = () =>
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
      expect(mocks.command.mock.calls.map(([name]) => name)).toEqual(["wslpath", "powershell.exe"]);
      expect(osc52Writes).toHaveLength(0);
    }),
  );

const wslWithADisplayPrefersTheLinux = () =>
  runTest(
    Effect.gen(function* () {
      mocks.platform.mockReturnValue("linux");
      vi.stubEnv("WSL_DISTRO_NAME", "Ubuntu");
      vi.stubEnv("WAYLAND_DISPLAY", "wayland-0");
      yield* awaited(copyToClipboard("hello"));
      expect(mocks.command.mock.calls.map(([name]) => name)).toEqual(["wl-copy"]);
      expect(osc52Writes).toHaveLength(0);
    }),
  );

const reportsTheWaylandClipboardToolInsteadOf = () =>
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
      expect(mocks.command.mock.calls.map(([name]) => name)).toEqual(["wl-copy", "xclip", "xsel"]);
    }),
  );

const termuxOnAndroidWritesThroughTermuxClipboard = () =>
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
  );

const reportsTheTermuxApiRequirementOnAndroid = () =>
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
  );

const usesOsc52WhenNativeAndCommand = () =>
  runTest(
    Effect.gen(function* () {
      vi.stubEnv("SSH_CONNECTION", "client server");
      mocks.clipboard.setText.mockRejectedValue(new Error("native failed"));
      mocks.command.mockResolvedValue(undefined);
      yield* awaited(copyToClipboard("hello"));
      expect(osc52Writes).toHaveLength(1);
    }),
  );

const doesNotEmitOversizedOsc52Payloads = () =>
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
  );

describe("copyToClipboard on WSL and Termux", () => {
  test(
    "WSL without a display writes the Windows clipboard through PowerShell",
    wslWithoutADisplayWritesTheWindows,
  );
  test("WSL falls back to OSC 52 when Windows interop is unavailable", wslFallsBackToOsc52When);
  test("WSL in Windows Terminal prefers OSC 52 over PowerShell", wslInWindowsTerminalPrefersOsc52);
  test(
    "WSL in Windows Terminal emits OSC 52 once in a remote session",
    wslInWindowsTerminalEmitsOsc52,
  );
  test(
    "WSL in Windows Terminal uses PowerShell for oversized OSC 52 payloads",
    wslInWindowsTerminalUsesPowershellFor,
  );
  test("WSL with a display prefers the Linux clipboard tools", wslWithADisplayPrefersTheLinux);
  test(
    "reports the Wayland clipboard tool instead of the X11 fallback",
    reportsTheWaylandClipboardToolInsteadOf,
  );
  test(
    "Termux on Android writes through termux-clipboard-set",
    termuxOnAndroidWritesThroughTermuxClipboard,
  );
  test("reports the Termux:API requirement on Android", reportsTheTermuxApiRequirementOnAndroid);
  test(
    "uses OSC 52 when native and command writes fail in a remote session",
    usesOsc52WhenNativeAndCommand,
  );
  test("does not emit oversized OSC 52 payloads", doesNotEmitOversizedOsc52Payloads);
});
