import testing from "@msa/testing";
import tui from "@msa/tui";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import InteractiveMode from "../src/modes/interactive/interactive-mode.ts";
import tuiRenderer from "../src/modes/interactive/tui-renderer.ts";
import RecordingTerminal from "./interactive-tui-support.ts";

const { createInteractiveTui } = tuiRenderer;

const { Text } = tui;
const { awaited, runTest } = testing;

const clipboardMocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn<(text: string) => Promise<void>>(),
  readClipboardFilePaths: vi.fn<() => Promise<string[] | null>>(),
  readClipboardText: vi.fn<() => Promise<string | null>>(),
}));

vi.mock("../src/utils/clipboard.ts", () => ({ default: clipboardMocks }));

type CopyCommandContext = {
  session: { context: { transcript: { getLastAssistantText: () => string | undefined } } };
  ui: ReturnType<typeof createInteractiveTui>;
  showStatus: (message: string) => void;
  showError: (message: string) => void;
};

type CopyCommandOptions = { flashConfirmation?: boolean; preferSelection?: boolean };

type CopyCommandPrototype = {
  handleCopyCommand(this: CopyCommandContext, options?: CopyCommandOptions): Promise<void>;
};

const copyCommandPrototype = InteractiveMode.prototype as unknown as CopyCommandPrototype;

type CopyProbe = {
  getLastAssistantText: ReturnType<typeof vi.fn>;
  showError: ReturnType<typeof vi.fn>;
  showStatus: ReturnType<typeof vi.fn>;
  terminal: InstanceType<typeof RecordingTerminal>;
};

const copyWithActiveSelection = (
  copyOnSelect: boolean | undefined,
  check: (probe: CopyProbe) => void,
) =>
  Effect.gen(function* () {
    const terminal = new RecordingTerminal(40, 4);
    const ui = createInteractiveTui({
      ...(copyOnSelect === undefined ? {} : { fullscreenCopyOnSelect: copyOnSelect }),
      logDirectory: "/tmp",
      showHardwareCursor: false,
      terminal,
      tuiMode: "fullscreen",
    });
    const probe = {
      getLastAssistantText: vi.fn(() => "assistant response"),
      showError: vi.fn(),
      showStatus: vi.fn(),
      terminal,
    };
    const context: CopyCommandContext = {
      session: { context: { transcript: { getLastAssistantText: probe.getLastAssistantText } } },
      showError: probe.showError,
      showStatus: probe.showStatus,
      ui,
    };
    ui.addChild(new Text("alpha\nbeta\ngamma\ndelta", 0, 0));

    ui.start();
    try {
      yield* awaited(terminal.waitForRender());
      terminal.sendInput("\x1b[<0;1;1M");
      terminal.sendInput("\x1b[<32;4;2M");
      terminal.sendInput("\x1b[<0;4;2m");
      yield* awaited(terminal.waitForRender());
      clipboardMocks.copyToClipboard.mockClear();

      yield* awaited(
        copyCommandPrototype.handleCopyCommand.call(context, {
          flashConfirmation: true,
          preferSelection: true,
        }),
      );
      yield* awaited(terminal.waitForRender());
      check(probe);
    } finally {
      ui.stop();
    }
  });

describe("InteractiveMode copy confirmation", () => {
  beforeEach(() => {
    clipboardMocks.copyToClipboard.mockReset();
    clipboardMocks.copyToClipboard.mockResolvedValue(undefined);
  });

  it("copies an active fullscreen selection when copy-on-select is disabled", () =>
    runTest(
      copyWithActiveSelection(
        false,
        ({ getLastAssistantText, showError, showStatus, terminal }) => {
          expect(clipboardMocks.copyToClipboard).toHaveBeenCalledOnce();
          expect(clipboardMocks.copyToClipboard).toHaveBeenCalledWith("alpha\nbeta");
          expect(getLastAssistantText).not.toHaveBeenCalled();
          expect(showStatus).not.toHaveBeenCalled();
          expect(showError).not.toHaveBeenCalled();
          expect(terminal.getViewport().some((line) => line.includes("Copied!"))).toBe(true);
        },
      ),
    ));
});

describe("InteractiveMode copy confirmation", () => {
  beforeEach(() => {
    clipboardMocks.copyToClipboard.mockReset();
    clipboardMocks.copyToClipboard.mockResolvedValue(undefined);
  });

  it("copies the last assistant message with an active fullscreen selection when copy-on-select is enabled", () =>
    runTest(
      copyWithActiveSelection(
        undefined,
        ({ getLastAssistantText, showError, showStatus, terminal }) => {
          expect(clipboardMocks.copyToClipboard).toHaveBeenCalledOnce();
          expect(clipboardMocks.copyToClipboard).toHaveBeenCalledWith("assistant response");
          expect(getLastAssistantText).toHaveBeenCalledOnce();
          expect(showStatus).not.toHaveBeenCalled();
          expect(showError).not.toHaveBeenCalled();
          expect(terminal.getViewport().some((line) => line.includes("Copied!"))).toBe(true);
        },
      ),
    ));
});

describe("InteractiveMode copy confirmation", () => {
  beforeEach(() => {
    clipboardMocks.copyToClipboard.mockReset();
    clipboardMocks.copyToClipboard.mockResolvedValue(undefined);
  });

  it("flashes Copied! for the copy shortcut in fullscreen mode", () =>
    runTest(
      Effect.gen(function* () {
        const terminal = new RecordingTerminal(40, 4);
        const ui = createInteractiveTui({
          logDirectory: "/tmp",
          showHardwareCursor: false,
          terminal,
          tuiMode: "fullscreen",
        });
        const showStatus = vi.fn();
        const showError = vi.fn();
        const context: CopyCommandContext = {
          session: {
            context: { transcript: { getLastAssistantText: () => "assistant response" } },
          },
          showError,
          showStatus,
          ui,
        };

        ui.start();
        try {
          yield* awaited(terminal.waitForRender());
          yield* awaited(
            copyCommandPrototype.handleCopyCommand.call(context, {
              flashConfirmation: true,
              preferSelection: true,
            }),
          );
          yield* awaited(terminal.waitForRender());

          expect(clipboardMocks.copyToClipboard).toHaveBeenCalledWith("assistant response");
          expect(showStatus).not.toHaveBeenCalled();
          expect(showError).not.toHaveBeenCalled();
          expect(terminal.getViewport().some((line) => line.includes("Copied!"))).toBe(true);
        } finally {
          ui.stop();
        }
      }),
    ));
});

describe("InteractiveMode copy confirmation", () => {
  beforeEach(() => {
    clipboardMocks.copyToClipboard.mockReset();
    clipboardMocks.copyToClipboard.mockResolvedValue(undefined);
  });

  it("keeps the status-line confirmation for the copy shortcut in regular mode", () =>
    runTest(
      Effect.gen(function* () {
        const ui = createInteractiveTui({
          logDirectory: "/tmp",
          showHardwareCursor: false,
          terminal: new RecordingTerminal(),
          tuiMode: "regular",
        });
        const showStatus = vi.fn();
        const showError = vi.fn();
        const context: CopyCommandContext = {
          session: {
            context: { transcript: { getLastAssistantText: () => "assistant response" } },
          },
          showError,
          showStatus,
          ui,
        };

        yield* awaited(
          copyCommandPrototype.handleCopyCommand.call(context, {
            flashConfirmation: true,
            preferSelection: true,
          }),
        );

        expect(showStatus).toHaveBeenCalledWith("Copied last agent message to clipboard");
        expect(showError).not.toHaveBeenCalled();
      }),
    ));
});
