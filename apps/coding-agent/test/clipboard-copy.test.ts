import testing from "@msa/testing";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { copyToClipboard } from "../src/utils/clipboard.ts";

const { awaited, deferredPromise, runTest } = testing;

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

const localNativeSuccessSkipsOsc52And = () =>
  runTest(
    Effect.gen(function* () {
      yield* awaited(copyToClipboard("hello"));
      expect(mocks.clipboard.setText).toHaveBeenCalledWith("hello");
      expect(osc52Writes).toHaveLength(0);
      expect(mocks.command).not.toHaveBeenCalled();
    }),
  );

const linuxSkipsTheNativeWriter = () =>
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
  );

const waitsForTheNativeWriteBeforeEmitting = () =>
  runTest(
    Effect.gen(function* () {
      vi.stubEnv("SSH_CONNECTION", "client server");
      const deferred = deferredPromise<void>();
      const complete = deferred.resolve;
      mocks.clipboard.setText.mockReturnValue(deferred.promise);
      const copy = copyToClipboard("hello");
      expect(osc52Writes).toHaveLength(0);
      complete();
      yield* awaited(copy);
      expect(osc52Writes).toHaveLength(1);
      expect(mocks.command).not.toHaveBeenCalled();
    }),
  );

const aRejectedNativeWriteFallsBackTo = () =>
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
  );

const aReadOnlyNativeClipboardUsesThe = () =>
  runTest(
    Effect.gen(function* () {
      mocks.getNativeClipboard.mockReturnValue({
        getImage: mocks.clipboard.getImage,
        getText: mocks.clipboard.getText,
      });
      yield* awaited(copyToClipboard("hello"));
      expect(mocks.command).toHaveBeenCalledOnce();
    }),
  );

const triesXclipAndXselAfterWlCopy = () =>
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
      expect(mocks.command.mock.calls.map(([name]) => name)).toEqual(["wl-copy", "xclip", "xsel"]);
      expect(osc52Writes).toHaveLength(0);
    }),
  );

const localLinuxFailureDoesNotReportAn = () =>
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
  );

const displayLessLinuxFallsBackToOsc = () =>
  runTest(
    Effect.gen(function* () {
      mocks.platform.mockReturnValue("linux");
      yield* awaited(copyToClipboard("hello"));
      expect(mocks.command).not.toHaveBeenCalled();
      expect(osc52Writes).toHaveLength(1);
    }),
  );

describe("copyToClipboard", () => {
  test("local native success skips OSC 52 and commands", localNativeSuccessSkipsOsc52And);
  test("Linux skips the native writer", linuxSkipsTheNativeWriter);
  test(
    "waits for the native write before emitting remote OSC 52",
    waitsForTheNativeWriteBeforeEmitting,
  );
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
          if (display !== undefined && display.length > 0) vi.stubEnv("DISPLAY", display);
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
  test("a rejected native write falls back to pbcopy", aRejectedNativeWriteFallsBackTo);
  test("a read-only native clipboard uses the command writer", aReadOnlyNativeClipboardUsesThe);
  test("tries xclip and xsel after wl-copy fails", triesXclipAndXselAfterWlCopy);
  test(
    "local Linux failure does not report an unverified OSC 52 write as success",
    localLinuxFailureDoesNotReportAn,
  );
  test("display-less Linux falls back to OSC 52", displayLessLinuxFallsBackToOsc);
});
