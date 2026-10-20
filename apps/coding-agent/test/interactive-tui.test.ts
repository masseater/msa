import testing from "@msa/testing";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import KeybindingsManager from "../src/core/keybindings-manager.ts";
import codingAgent from "../src/index.ts";
import type codingAgentTypes from "../src/index.types.ts";
import InteractiveMode from "../src/modes/interactive/interactive-mode.ts";
import tuiRenderer from "../src/modes/interactive/tui-renderer.ts";
import RecordingTerminal from "./interactive-tui-support.ts";

const { initTheme } = codingAgent;

const { createInteractiveTui, createInteractiveTuiReference } = tuiRenderer;

const { ScrollView, Text, getKeybindings, isViewportTUI, setKeybindings } = tui;
const { awaited, runTest } = testing;

const clipboardMocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn<(text: string) => Promise<void>>(),
  readClipboardFilePaths: vi.fn<() => Promise<string[] | null>>(),
  readClipboardText: vi.fn<() => Promise<string | null>>(),
}));

vi.mock("../src/utils/clipboard.ts", () => ({ default: clipboardMocks }));

const showsTheConfiguredJumpToBottomShortcut = Effect.gen(function* () {
  initTheme("dark");
  const previousKeybindings = getKeybindings();
  setKeybindings(new KeybindingsManager({ "tui.altScreen.bottom": "ctrl+j" }));
  const terminal = new RecordingTerminal(50, 4);
  const ui = createInteractiveTui({
    logDirectory: "/tmp",
    showHardwareCursor: false,
    terminal,
    tuiMode: "fullscreen",
  });
  ui.setLayoutRoot(
    new ScrollView(
      new Text(Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0),
      {
        follow: "end",
        primary: true,
      },
    ),
  );
  ui.start();
  try {
    yield* awaited(terminal.waitForRender());
    terminal.sendInput("\x1b[<64;1;1M");
    yield* awaited(terminal.waitForRender());
    expect(terminal.getViewport()[3]).toContain("↓ Jump to latest message · Ctrl+J");
  } finally {
    ui.stop();
    setKeybindings(previousKeybindings);
  }
});

const selectsTheAlternateScreenRendererOnlyWhen = Effect.gen(function* () {
  const mainTerminal = new RecordingTerminal();
  const mainTui = createInteractiveTui({
    logDirectory: "/tmp",
    showHardwareCursor: false,
    terminal: mainTerminal,
    tuiMode: "regular",
  });
  expect(mainTui.mode).toBe("regular");
  expect(isViewportTUI(mainTui)).toBe(false);
  mainTui.start();
  yield* awaited(mainTerminal.waitForRender());
  expect(mainTerminal.writes.some((write) => write.includes("\x1b[?1049h"))).toBe(false);
  mainTui.stop();

  const altTerminal = new RecordingTerminal();
  const altTui = createInteractiveTui({
    logDirectory: "/tmp",
    showHardwareCursor: false,
    terminal: altTerminal,
    tuiMode: "fullscreen",
  });
  expect(altTui.mode).toBe("fullscreen");
  expect(isViewportTUI(altTui)).toBe(true);
  altTui.start();
  yield* awaited(altTerminal.waitForRender());
  expect(altTerminal.writes.some((write) => write.includes("\x1b[?1049h"))).toBe(true);
  altTui.stop();
});

type SwitchContext = {
  runtimeHost: {
    session: {
      settingsManager: {
        getFullscreenCopyOnSelect: () => boolean;
        getFullscreenWheelScrollLines: () => tuiTypes.WheelScrollLines;
      };
    };
  };
  renderer: ReturnType<typeof createInteractiveTui>;
  ui: tuiTypes.TUI;
  fullscreenLayoutRoot: tuiTypes.Component;
  options: { tuiMode?: codingAgentTypes.TuiMode };
  themeController: { rebindTui: () => void };
  extensionTerminalInputSubscriptions: Set<never>;
};

const createSwitchContext = (
  renderer: ReturnType<typeof createInteractiveTui>,
  component: tuiTypes.Component,
): SwitchContext =>
  Object.assign(Object.create(InteractiveMode.prototype), {
    extensionTerminalInputSubscriptions: new Set<never>(),
    fullscreenLayoutRoot: component,
    options: { tuiMode: "regular" as codingAgentTypes.TuiMode },
    renderer,
    runtimeHost: {
      session: {
        settingsManager: {
          getFullscreenCopyOnSelect: () => true,
          getFullscreenWheelScrollLines: () => "auto",
        },
      },
    },
    themeController: { rebindTui: () => {} },
    ui: undefined as unknown as tuiTypes.TUI,
  }) as SwitchContext;

const replacesTheRendererAndRestoresThePrevious = Effect.gen(function* () {
  const terminal = new RecordingTerminal(40, 8);
  const renderer = createInteractiveTui({
    logDirectory: "/tmp",
    showHardwareCursor: false,
    terminal,
    tuiMode: "regular",
  });
  let stableUi: tuiTypes.TUI;
  const invalidatedModes: codingAgentTypes.TuiMode[] = [];
  const component: tuiTypes.Component & { focused: boolean } = {
    focused: false,
    invalidate: () => invalidatedModes.push(stableUi.mode),
    render: () => ["content"],
  };
  renderer.addChild(component);
  renderer.setFocus(component);

  const context = createSwitchContext(renderer, component);
  stableUi = createInteractiveTuiReference(() => context.renderer);
  context.ui = stableUi;
  const { stopInteractiveTui, switchTuiMode } = InteractiveMode.prototype as unknown as {
    stopInteractiveTui(
      this: SwitchContext,
      fullscreenExitOutput: codingAgentTypes.FullscreenExitOutput,
    ): void;
    switchTuiMode(
      this: SwitchContext,
      mode: codingAgentTypes.TuiMode,
      restoreProgress?: boolean,
    ): boolean;
  };

  renderer.start();
  yield* awaited(terminal.waitForRender());
  expect(switchTuiMode.call(context, "fullscreen", false)).toBe(true);
  yield* awaited(terminal.waitForRender());

  expect(stableUi.mode).toBe("fullscreen");
  expect(context.renderer.children).toEqual([component]);
  expect(context.renderer.getFocusedComponent()).toBe(component);
  expect(component.focused).toBe(true);
  expect(invalidatedModes).toEqual(["fullscreen"]);
  expect([terminal.startCount, terminal.stopCount]).toEqual([2, 1]);

  stopInteractiveTui.call(context, "resume-hint");

  expect(stableUi.mode).toBe("fullscreen");
  expect([terminal.startCount, terminal.stopCount]).toEqual([2, 2]);
});

describe("createInteractiveTui", () => {
  it("selects the alternate-screen renderer only when requested", () =>
    runTest(selectsTheAlternateScreenRendererOnlyWhen));

  it("shows the configured jump-to-bottom shortcut while scrolled up", () =>
    runTest(showsTheConfiguredJumpToBottomShortcut));

  it("replaces the renderer and restores the previous screen for resume-hint exits", () =>
    runTest(replacesTheRendererAndRestoresThePrevious));
});

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
  const prototype = InteractiveMode.prototype as unknown as {
    handleRightClickPaste(this: typeof context): Promise<void>;
  };

  yield* awaited(prototype.handleRightClickPaste.call(context));

  expect(handleInput).toHaveBeenCalledWith("\x1b[200~clipboard text\x1b[201~");
  expect(requestRender).toHaveBeenCalledOnce();
});

describe("InteractiveMode right-click paste", () => {
  it("feeds clipboard text to the focused component as a bracketed paste", () =>
    runTest(feedsClipboardTextToTheFocusedComponent));
});
