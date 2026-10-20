import testing from "@msa/testing";
import type tui from "@msa/tui";
import { Effect } from "effect";
import { afterEach, expect, test, vi } from "vite-plus/test";

import interactiveModeFake from "./interactive-mode-fake.ts";

const { bindModeFake } = interactiveModeFake;

const { awaited, runTest } = testing;

const readClipboardText = vi.hoisted(() => vi.fn<() => Promise<string | null>>());
vi.mock("@msa/tui", (importOriginal) =>
  testing.runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());
      const actual = yield* testing.awaited(importOriginal<{ default: typeof tui }>());
      return {
        ...actual,
        default: {
          ...actual.default,
          getNativeClipboard: () => ({
            getImage() {
              return effectRunPromise(
                Effect.sync(() => {
                  throw new Error("Native clipboard operation failed");
                }),
              );
            },
          }),
        },
      };
    }),
  ),
);
vi.mock("../src/utils/clipboard.ts", () => ({
  default: {
    copyToClipboard: vi.fn(),
    readClipboardFilePaths: vi.fn(() => testing.runTest(testing.awaited(null))),
    readClipboardText,
  },
}));
vi.mock("../src/utils/clipboard-command.ts", () => ({
  default: {
    runClipboardCommand: vi.fn(() => testing.runTest(testing.awaited(undefined))),
  },
}));
afterEach(() => vi.unstubAllEnvs());

const nativeImageErrorsAbortPasteWithoutReading = () =>
  runTest(
    Effect.gen(function* () {
      vi.stubEnv("TERMUX_VERSION", "");
      const context = {
        editor: { insertTextAtCursor: vi.fn() },
        settingsManager: { getClipboardImageCommand: () => undefined },
        showError: vi.fn(),
        ui: { requestRender: vi.fn() },
      };
      bindModeFake(context);
      yield* awaited(bindModeFake(context).input.clipboard.handleClipboardPaste());
      expect(readClipboardText).not.toHaveBeenCalled();
      expect(context.editor.insertTextAtCursor).not.toHaveBeenCalled();
      expect(context.ui.requestRender).not.toHaveBeenCalled();
      expect(context.showError).toHaveBeenCalledExactlyOnceWith(
        "Failed to paste from clipboard: Native clipboard operation failed",
      );
    }),
  );

test(
  "native image errors abort paste without reading text or changing the editor",
  nativeImageErrorsAbortPasteWithoutReading,
);
