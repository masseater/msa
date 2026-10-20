import testing from "@msa/testing";
import { Effect } from "effect";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import interactiveModeFake from "./interactive-mode-fake.ts";

const { bindModeFake } = interactiveModeFake;

const { awaited, readBytesFile, removePath, runTest } = testing;

const mocks = vi.hoisted(() => ({
  readClipboardFilePaths: vi.fn<() => Promise<string[] | null>>(),
  readClipboardImage: vi.fn<() => Promise<{ bytes: Uint8Array; mimeType: string } | null>>(),
  readClipboardImageFromCommand:
    vi.fn<() => Promise<{ bytes: Uint8Array; mimeType: string } | null | undefined>>(),
  readClipboardText: vi.fn<() => Promise<string | null>>(),
}));

vi.mock("../src/utils/clipboard.ts", () => ({
  default: {
    copyToClipboard: vi.fn(),
    readClipboardFilePaths: mocks.readClipboardFilePaths,
    readClipboardText: mocks.readClipboardText,
  },
}));
vi.mock("../src/utils/clipboard-image.ts", () => ({
  default: {
    extensionForImageMimeType: () => "png",
    readClipboardImage: mocks.readClipboardImage,
    readClipboardImageFromCommand: mocks.readClipboardImageFromCommand,
  },
}));

beforeEach(() => vi.resetAllMocks());

const finderFilePathsTakePrecedenceOverTheir = () =>
  runTest(
    Effect.gen(function* () {
      const filePaths = ["/tmp/screenshot.png", "/tmp/My Photos/photo.png"];
      mocks.readClipboardFilePaths.mockResolvedValue(filePaths);
      mocks.readClipboardImage.mockResolvedValue({
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        mimeType: "image/png",
      });
      mocks.readClipboardText.mockResolvedValue(null);
      const insertTextAtCursor = vi.fn<(text: string) => void>();
      const context = {
        editor: { insertTextAtCursor },
        settingsManager: { terminal: { getClipboardImageCommand: () => undefined } },
        showError: vi.fn(),
        ui: { requestRender: vi.fn() },
      };
      bindModeFake(context);
      yield* awaited(bindModeFake(context).input.clipboard.handleClipboardPaste());
      expect(insertTextAtCursor).toHaveBeenCalledExactlyOnceWith(filePaths.join("\n"));
      expect(mocks.readClipboardImage).not.toHaveBeenCalled();
    }),
  );

test(
  "Finder file paths take precedence over their icon image",
  finderFilePathsTakePrecedenceOverTheir,
);

const clipboardFilePathsContainingTerminalControlCharacters = () =>
  runTest(
    Effect.gen(function* () {
      const insertTextAtCursor = vi.fn<(text: string) => void>();
      const showError = vi.fn<(message: string) => void>();
      mocks.readClipboardFilePaths.mockResolvedValue(["/tmp/photo\x1b]0;unsafe\x07.png"]);
      const context = {
        editor: { insertTextAtCursor },
        settingsManager: { terminal: { getClipboardImageCommand: () => undefined } },
        showError,
        ui: { requestRender: vi.fn() },
      };
      bindModeFake(context);
      yield* awaited(bindModeFake(context).input.clipboard.handleClipboardPaste());

      expect(insertTextAtCursor).not.toHaveBeenCalled();
      expect(mocks.readClipboardImage).not.toHaveBeenCalled();
      expect(showError).toHaveBeenCalledExactlyOnceWith(
        "Failed to paste from clipboard: Clipboard file path contains control characters",
      );
    }),
  );

test(
  "clipboard file paths containing terminal control characters are rejected",
  clipboardFilePathsContainingTerminalControlCharacters,
);

const nativeFilePathErrorsAreShownWithout = () =>
  runTest(
    Effect.gen(function* () {
      const showError = vi.fn<(message: string) => void>();
      mocks.readClipboardFilePaths.mockRejectedValue(
        new Error("Native clipboard file read failed"),
      );
      const context = {
        editor: { insertTextAtCursor: vi.fn() },
        settingsManager: { terminal: { getClipboardImageCommand: () => undefined } },
        showError,
        ui: { requestRender: vi.fn() },
      };
      bindModeFake(context);
      yield* awaited(bindModeFake(context).input.clipboard.handleClipboardPaste());

      expect(context.editor.insertTextAtCursor).not.toHaveBeenCalled();
      expect(mocks.readClipboardImage).not.toHaveBeenCalled();
      expect(showError).toHaveBeenCalledExactlyOnceWith(
        "Failed to paste from clipboard: Native clipboard file read failed",
      );
    }),
  );

test(
  "native file-path errors are shown without falling through to the icon image",
  nativeFilePathErrorsAreShownWithout,
);

test.each([
  ["punctuation", "Review:", 7],
  ["Unicode text", "確認", 2],
])("clipboard file paths are separated from preceding %s", (_description, editorText, cursorCol) =>
  runTest(
    Effect.gen(function* () {
      const insertTextAtCursor = vi.fn<(text: string) => void>();
      mocks.readClipboardFilePaths.mockResolvedValue(["/tmp/photo.png"]);
      const context = {
        editor: {
          getCursor: () => ({ col: cursorCol, line: 0 }),
          getText: () => editorText,
          insertTextAtCursor,
        },
        settingsManager: { terminal: { getClipboardImageCommand: () => undefined } },
        showError: vi.fn(),
        ui: { requestRender: vi.fn() },
      };
      bindModeFake(context);
      yield* awaited(bindModeFake(context).input.clipboard.handleClipboardPaste());

      expect(insertTextAtCursor).toHaveBeenCalledExactlyOnceWith(" /tmp/photo.png");
      expect(mocks.readClipboardImage).not.toHaveBeenCalled();
    }),
  ),
);

const bashModeShellQuotesFilePathsAnd = () =>
  runTest(
    Effect.gen(function* () {
      const insertTextAtCursor = vi.fn<(text: string) => void>();
      mocks.readClipboardFilePaths.mockResolvedValue([
        "/tmp/My Photos/photo.png",
        "/tmp/$(touch hacked).png",
        "/tmp/plain.png",
      ]);
      const context = {
        editor: {
          getCursor: () => ({ col: 3, line: 0 }),
          getText: () => "catDEST",
          insertTextAtCursor,
        },
        isBashMode: true,
        settingsManager: { terminal: { getClipboardImageCommand: () => undefined } },
        showError: vi.fn(),
        ui: { requestRender: vi.fn() },
      };
      bindModeFake(context);
      yield* awaited(bindModeFake(context).input.clipboard.handleClipboardPaste());

      expect(insertTextAtCursor).toHaveBeenCalledExactlyOnceWith(
        " '/tmp/My Photos/photo.png' '/tmp/$(touch hacked).png' /tmp/plain.png ",
      );
      expect(mocks.readClipboardImage).not.toHaveBeenCalled();
    }),
  );

test(
  "bash mode shell-quotes file paths and inserts them as arguments",
  bashModeShellQuotesFilePathsAnd,
);

function pasteContext() {
  const context = {
    editor: { insertTextAtCursor: vi.fn<(text: string) => void>() },
    settingsManager: { terminal: { getClipboardImageCommand: () => "remote-clipboard" } },
    showError: vi.fn<(message: string) => void>(),
    showStatus: vi.fn<(message: string) => void>(),
    ui: { requestRender: vi.fn() },
  };
  bindModeFake(context);
  return context;
}

const paste = (context: ReturnType<typeof pasteContext>) =>
  bindModeFake(context).input.clipboard.handleClipboardPaste();

describe("with clipboardImageCommand", () => {
  test("inserts the command's image and ignores the local clipboard", () =>
    runTest(
      Effect.gen(function* () {
        mocks.readClipboardImageFromCommand.mockResolvedValue({
          bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
          mimeType: "image/png",
        });
        const context = pasteContext();

        yield* awaited(paste(context));

        expect(mocks.readClipboardImageFromCommand).toHaveBeenCalledWith("remote-clipboard");
        const inserted = context.editor.insertTextAtCursor.mock.calls[0]?.[0] ?? "";
        expect(inserted).toMatch(/msa-clipboard-.*\.png$/u);
        expect([...(yield* readBytesFile(inserted))]).toEqual([0x89, 0x50, 0x4e, 0x47]);
        yield* removePath(inserted);
        expect(mocks.readClipboardFilePaths).not.toHaveBeenCalled();
        expect(mocks.readClipboardImage).not.toHaveBeenCalled();
        expect(mocks.readClipboardText).not.toHaveBeenCalled();
      }),
    ));

  test("says when the clipboard has no image, and when the command fails", () =>
    runTest(
      Effect.gen(function* () {
        const empty = pasteContext();
        mocks.readClipboardImageFromCommand.mockResolvedValue(null);
        yield* awaited(paste(empty));
        expect(empty.showStatus).toHaveBeenLastCalledWith("No image in the clipboard");
        expect(empty.editor.insertTextAtCursor).not.toHaveBeenCalled();

        const failed = pasteContext();
        mocks.readClipboardImageFromCommand.mockResolvedValue(undefined);
        yield* awaited(paste(failed));
        expect(failed.showError).toHaveBeenCalledOnce();
        expect(mocks.readClipboardText).not.toHaveBeenCalled();
      }),
    ));
});
