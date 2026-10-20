import testing from "@msa/testing";
import type { NativeClipboard } from "@msa/tui";
import { Effect } from "effect";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { readClipboardImage } from "../src/utils/clipboard-image.ts";

const { awaited, runTest, writeBytesFile } = testing;

const mocks = vi.hoisted(() => ({
  command:
    vi.fn<(command: string, args: string[], options?: unknown) => Promise<Buffer | undefined>>(),
  getImage: vi.fn<NativeClipboard["getImage"]>(),
  getNativeClipboard: vi.fn<() => NativeClipboard | undefined>(),
}));

vi.mock("../src/utils/clipboard-command.ts", () => ({ runClipboardCommand: mocks.command }));
vi.mock("@msa/tui", () => ({ getNativeClipboard: mocks.getNativeClipboard }));

function commandResult(stdout: Buffer, status = 0): Buffer | undefined {
  return status === 0 ? stdout : undefined;
}

const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
]);

const x11DoesNotProbeImageTypesWhen = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  mocks.getImage.mockResolvedValue(null);
  mocks.command.mockImplementation((_command, args) =>
    effectRunPromise(awaited(args.includes("TARGETS") ? undefined : Buffer.from("hello"))),
  );
  expect(
    yield* awaited(readClipboardImage({ env: { DISPLAY: ":0" }, platform: "linux" })),
  ).toBeNull();
  expect(mocks.command).toHaveBeenCalledExactlyOnceWith(
    "xclip",
    ["-selection", "clipboard", "-t", "TARGETS", "-o"],
    { timeoutMs: 1000 },
  );
  expect(mocks.getImage).toHaveBeenCalledOnce();
});

const x11DoesNotProbeUnadvertisedImageTypes = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  mocks.getImage.mockResolvedValue(null);
  mocks.command.mockImplementation((_command, args) =>
    effectRunPromise(
      Effect.gen(function* () {
        if (args.includes("TARGETS")) return yield* awaited(Buffer.from("image/png\n"));
        if (args.includes("image/png")) return yield* awaited(undefined);
        return yield* awaited(Buffer.from("hello"));
      }),
    ),
  );
  expect(
    yield* awaited(readClipboardImage({ env: { DISPLAY: ":0" }, platform: "linux" })),
  ).toBeNull();
  expect(mocks.command.mock.calls.map(([, args]) => args[3])).toEqual(["TARGETS", "image/png"]);
  expect(mocks.getImage).toHaveBeenCalledOnce();
});

const wslTriesPowershellBeforeABrokenNative = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  mocks.getImage.mockRejectedValue(new Error("Broken X11 bridge"));
  let tmpFile: string | undefined;
  mocks.command.mockImplementation((command, args, options) =>
    effectRunPromise(
      Effect.gen(function* () {
        if (command === "wl-paste" || command === "xclip") return yield* awaited(undefined);
        if (command === "wslpath") {
          tmpFile = args[1];
          return yield* awaited(commandResult(Buffer.from("C:\\Users\\O'Hare\\clip.png\n")));
        }
        if (command === "powershell.exe") {
          const spawnOptions = options as { env?: NodeJS.ProcessEnv };
          expect(spawnOptions.env?.["MSA_WSL_CLIPBOARD_IMAGE_PATH"]).toBeUndefined();
          expect(args[2]).toContain("$path = 'C:\\Users\\O''Hare\\clip.png'");
          if (!(tmpFile !== undefined && tmpFile.length > 0))
            throw new Error("wslpath should be called before powershell.exe");
          yield* writeBytesFile(tmpFile, png);
          return yield* awaited(commandResult(Buffer.from("ok\n")));
        }
        throw new Error(`Unexpected command: ${command}`);
      }),
    ),
  );
  expect(
    yield* awaited(readClipboardImage({ env: { WSL_DISTRO_NAME: "Ubuntu" }, platform: "linux" })),
  ).toEqual({
    bytes: new Uint8Array(png),
    mimeType: "image/png",
  });
  expect(mocks.getNativeClipboard).not.toHaveBeenCalled();
});

const returnsNullWithoutANativeHelper = Effect.gen(function* () {
  mocks.getNativeClipboard.mockReturnValue(undefined);
  expect(yield* awaited(readClipboardImage({ env: {}, platform: "win32" }))).toBeNull();
  expect(mocks.getImage).not.toHaveBeenCalled();
});

const termuxDoesNotReadImageClipboards = Effect.gen(function* () {
  expect(
    yield* awaited(readClipboardImage({ env: { TERMUX_VERSION: "0.119" }, platform: "linux" })),
  ).toBeNull();
  expect(mocks.getNativeClipboard).not.toHaveBeenCalled();
  expect(mocks.command).not.toHaveBeenCalled();
});

const beforeEachHook = () => {
  vi.resetAllMocks();
  mocks.command.mockResolvedValue(commandResult(Buffer.alloc(0), 1));
  mocks.getImage.mockResolvedValue(png);
  mocks.getNativeClipboard.mockReturnValue({
    getImage: mocks.getImage,
    getText: () => runTest(awaited(null)),
  });
};

const imageOrNull = (bytes: Uint8Array | null | undefined) =>
  bytes?.length !== undefined && bytes?.length !== 0 ? { bytes, mimeType: "image/png" } : null;

const commandImageStopsFallback = (
  command: string,
  env: Record<string, string>,
  present: boolean,
) =>
  Effect.gen(function* () {
    mocks.command.mockImplementation((name, args) => {
      expect(name).toBe(command);
      const listing = args.includes("--list-types") || args.includes("TARGETS");
      return Promise.resolve(
        commandResult(
          listing ? Buffer.from(present ? "text/plain\nimage/png\n" : "text/plain\n") : png,
        ),
      );
    });
    expect(yield* awaited(readClipboardImage({ env, platform: "linux" }))).toEqual(
      present ? { bytes: png, mimeType: "image/png" } : null,
    );
    expect(mocks.command).toHaveBeenCalledTimes(present ? 2 : 1);
    expect(mocks.getNativeClipboard).not.toHaveBeenCalled();
  });

const nativeX11ResultStopsFallback = (bytes: Uint8Array | null) =>
  Effect.gen(function* () {
    mocks.getImage.mockResolvedValue(bytes);
    expect(
      yield* awaited(readClipboardImage({ env: { DISPLAY: ":0" }, platform: "linux" })),
    ).toEqual(imageOrNull(bytes));
    expect(mocks.getNativeClipboard).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.getImage).toHaveBeenCalledOnce();
    expect(mocks.command.mock.calls.map(([name]) => name)).toEqual(["xclip"]);
  });

const waylandFallsBackToX11 = (failure: string) =>
  Effect.gen(function* () {
    if (failure === "missing module") mocks.getNativeClipboard.mockReturnValue(undefined);
    else mocks.getImage.mockResolvedValue(undefined);
    mocks.command.mockImplementation((command, args) =>
      Promise.resolve(
        command === "wl-paste"
          ? commandResult(Buffer.alloc(0), 1)
          : commandResult(args.includes("TARGETS") ? Buffer.from("image/png\n") : Buffer.from(png)),
      ),
    );
    expect(
      yield* awaited(readClipboardImage({ env: { WAYLAND_DISPLAY: "1" }, platform: "linux" })),
    ).toEqual({ bytes: png, mimeType: "image/png" });
    expect(mocks.getNativeClipboard).not.toHaveBeenCalled();
  });

const readsNativeImageOnce = (platform: "darwin" | "win32", bytes: Uint8Array | null | undefined) =>
  Effect.gen(function* () {
    mocks.getImage.mockResolvedValue(bytes);
    expect(yield* awaited(readClipboardImage({ env: {}, platform }))).toEqual(imageOrNull(bytes));
    expect(mocks.getImage).toHaveBeenCalledOnce();
    expect(mocks.command).not.toHaveBeenCalled();
  });

const propagatesNativeTransferErrors = (platform: "linux" | "win32") =>
  Effect.gen(function* () {
    const error = new Error("Native clipboard operation failed");
    mocks.getImage.mockImplementation(() => Promise.reject(error));
    yield* awaited(
      expect(
        readClipboardImage({ env: { DISPLAY: ":0", WAYLAND_DISPLAY: "1" }, platform }),
      ).rejects.toBe(error),
    );
    expect(mocks.command.mock.calls.map(([name]) => name)).toEqual(
      platform === "linux" ? ["wl-paste", "xclip"] : [],
    );
  });

describe("readClipboardImage", () => {
  beforeEach(beforeEachHook);

  for (const [backend, command, env] of [
    ["wayland", "wl-paste", { DISPLAY: ":0", WAYLAND_DISPLAY: "1" }],
    ["x11", "xclip", { DISPLAY: ":0" }],
  ] as const) {
    test.each([true, false])(`${backend}: command image present=%s stops fallback`, (present) =>
      runTest(commandImageStopsFallback(command, env, present)),
    );
  }

  test("X11 does not probe image types when TARGETS fails", () =>
    runTest(x11DoesNotProbeImageTypesWhen));

  test("X11 does not probe unadvertised image types", () =>
    runTest(x11DoesNotProbeUnadvertisedImageTypes));

  test.each([png, null, new Uint8Array()])("native X11 result %j stops fallback", (bytes) =>
    runTest(nativeX11ResultStopsFallback(bytes)),
  );
  test.each(["missing module", "unavailable display"])(
    "Wayland: falls back to X11 after %s",
    (failure) => runTest(waylandFallsBackToX11(failure)),
  );

  test("WSL: tries PowerShell before a broken native X11 bridge", () =>
    runTest(wslTriesPowershellBeforeABrokenNative));

  for (const platform of ["darwin", "win32"] as const) {
    test.each([png, null, new Uint8Array(), undefined])(
      `${platform}: reads native image %j once`,
      (bytes) => runTest(readsNativeImageOnce(platform, bytes)),
    );
  }

  test("returns null without a native helper", () => runTest(returnsNullWithoutANativeHelper));

  test.each(["linux", "win32"] as const)(
    "%s: propagates native transfer errors without fallback",
    (platform) => runTest(propagatesNativeTransferErrors(platform)),
  );

  test("Termux does not read image clipboards", () => runTest(termuxDoesNotReadImageClipboards));
});
