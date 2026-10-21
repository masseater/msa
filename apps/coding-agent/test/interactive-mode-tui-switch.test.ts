import testing from "@msa/testing";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import InteractiveMode from "../src/modes/interactive/interactive-mode.ts";
import tuiRenderer from "../src/modes/interactive/tui-renderer.ts";
import interactiveModeFake from "./interactive-mode-fake.ts";
import RecordingTerminal from "./interactive-tui-support.ts";
import tuiKit from "./tui-kit.ts";

const { bindModeFake } = interactiveModeFake;
const { initTheme } = tuiKit;

const { createInteractiveTui, createInteractiveTuiReference } = tuiRenderer;

const { awaited, runTest } = testing;
const { resetCapabilitiesCache, setCapabilityOverrides } = tui;

type TuiMode = tuiTypes.TUI["mode"];

type SwitchContext = {
  runtimeHost: {
    session: {
      settingsManager: {
        terminal: {
          getFullscreenCopyOnSelect: () => boolean;
          getFullscreenWheelScrollLines: () => tuiTypes.WheelScrollLines;
        };
      };
    };
  };
  renderer: ReturnType<typeof createInteractiveTui>;
  ui: tuiTypes.TUI;
  fullscreenLayoutRoot: tuiTypes.Component;
  options: { tuiMode?: TuiMode };
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
    options: { tuiMode: "regular" as TuiMode },
    renderer,
    runtimeHost: {
      session: {
        settingsManager: {
          terminal: {
            getFullscreenCopyOnSelect: () => true,
            getFullscreenWheelScrollLines: () => "auto",
          },
        },
      },
    },
    themeController: { rebindTui: () => {} },
    ui: undefined as unknown as tuiTypes.TUI,
  }) as SwitchContext;

const replacesTheRendererAndRestoresThePrevious = Effect.gen(function* () {
  initTheme("dark");
  setCapabilityOverrides({ hyperlinks: false });
  const terminal = new RecordingTerminal(40, 8);
  const renderer = createInteractiveTui({
    logDirectory: "/tmp",
    showHardwareCursor: false,
    terminal,
    tuiMode: "regular",
  });
  let stableUi: tuiTypes.TUI;
  const invalidatedModes: TuiMode[] = [];
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
  const screen = bindModeFake(context).lifecycle.screen;

  renderer.start();
  yield* awaited(terminal.waitForRender());
  expect(screen.switchTuiMode("fullscreen", false)).toBe(true);
  yield* awaited(terminal.waitForRender());

  expect(stableUi.mode).toBe("fullscreen");
  expect(context.renderer.children).toEqual([component]);
  expect(context.renderer.getFocusedComponent()).toBe(component);
  expect(component.focused).toBe(true);
  expect(invalidatedModes).toEqual(["fullscreen"]);
  expect([terminal.startCount, terminal.stopCount]).toEqual([2, 1]);

  screen.stopInteractiveTui("resume-hint");

  expect(stableUi.mode).toBe("fullscreen");
  expect([terminal.startCount, terminal.stopCount]).toEqual([2, 2]);
});

describe("InteractiveMode TUI mode switch", () => {
  afterEach(() => {
    setCapabilityOverrides({});
    resetCapabilitiesCache();
  });

  it("replaces the renderer and restores the previous screen for resume-hint exits", () =>
    runTest(replacesTheRendererAndRestoresThePrevious));
});
