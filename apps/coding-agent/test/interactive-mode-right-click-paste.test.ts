import testing from "@msa/testing";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import interactiveModeFake from "./interactive-mode-fake.ts";

const { bindModeFake } = interactiveModeFake;

const { awaited, runTest } = testing;

const clipboardMocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn<(text: string) => Promise<void>>(),
  readClipboardFilePaths: vi.fn<() => Promise<string[] | null>>(),
  readClipboardText: vi.fn<() => Promise<string | null>>(),
}));

vi.mock("../src/utils/clipboard.ts", () => ({ default: clipboardMocks }));

const feedsClipboardTextToTheFocusedComponent = Effect.gen(function* () {
  clipboardMocks.readClipboardText.mockResolvedValue("clipboard text");
  const handleInput = vi.fn<(data: string) => void>();
  const target = {
    handleInput,
    invalidate: () => {},
    render: () => [],
  } satisfies tuiTypes.Component;
  const requestRender = vi.fn();
  const context = {
    renderer: { getFocusedComponent: () => target },
    ui: { requestRender },
  };
  yield* awaited(bindModeFake(context).input.clipboard.handleRightClickPaste());

  expect(handleInput).toHaveBeenCalledWith("\x1b[200~clipboard text\x1b[201~");
  expect(requestRender).toHaveBeenCalledOnce();
});

describe("InteractiveMode right-click paste", () => {
  it("feeds clipboard text to the focused component as a bracketed paste", () =>
    runTest(feedsClipboardTextToTheFocusedComponent));
});
