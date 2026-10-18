import { awaited, runTest } from "@msa/testing";
import type * as Tui from "@msa/tui";
import { Effect } from "effect";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

const readClipboardText = vi.hoisted(() => vi.fn<() => Promise<string | null>>());
vi.mock("@msa/tui", (importOriginal) =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());
      return {
        ...(yield* awaited(importOriginal<typeof Tui>())),
        getNativeClipboard: () => ({
          getImage() {
            return effectRunPromise(
              Effect.sync(() => {
                throw new Error("Native clipboard operation failed");
              }),
            );
          },
        }),
      };
    }),
  ),
);
vi.mock("../src/utils/clipboard.ts", () => ({
  copyToClipboard: vi.fn(),
  readClipboardFilePaths: vi.fn(() => runTest(awaited(null))),
  readClipboardText,
}));
vi.mock("../src/utils/clipboard-command.ts", () => ({
  runClipboardCommand: vi.fn(() => runTest(awaited(undefined))),
}));
afterEach(() => vi.unstubAllEnvs());

test("native image errors abort paste without reading text or changing the editor", () =>
  runTest(
    Effect.gen(function* () {
      vi.stubEnv("TERMUX_VERSION", "");
      const context = {
        editor: { insertTextAtCursor: vi.fn() },
        showError: vi.fn(),
        ui: { requestRender: vi.fn() },
        settingsManager: { getClipboardImageCommand: () => undefined },
      };
      const prototype = InteractiveMode.prototype as unknown as {
        handleClipboardPaste(this: typeof context): Promise<void>;
      };
      yield* awaited(prototype.handleClipboardPaste.call(context));
      expect(readClipboardText).not.toHaveBeenCalled();
      expect(context.editor.insertTextAtCursor).not.toHaveBeenCalled();
      expect(context.ui.requestRender).not.toHaveBeenCalled();
      expect(context.showError).toHaveBeenCalledExactlyOnceWith(
        "Failed to paste from clipboard: Native clipboard operation failed",
      );
    }),
  ));
