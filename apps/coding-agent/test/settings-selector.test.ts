import testing from "@msa/testing";
import { setKeybindings } from "@msa/tui";
import { Effect } from "effect";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { KeybindingsManager } from "../src/core/keybindings.ts";
import {
  type SettingsCallbacks,
  type SettingsConfig,
  SettingsSelectorComponent,
} from "../src/modes/interactive/components/settings-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import harnessModule from "./suite/harness.ts";
import type harnessTypes from "./suite/harness.types.ts";

const { createHarness } = harnessModule;

const { awaited, runTest } = testing;

let harness: harnessTypes.Harness | undefined;

const cyclesThroughFullscreenSettings = () => {
  const onExitOutputChange = vi.fn();
  const onScrollbarChange = vi.fn();
  const onCopyOnSelectChange = vi.fn();
  const onWheelScrollLinesChange = vi.fn();
  const config = {
    availableDefaultModels: [],
    availableThemes: [],
    availableThinkingLevels: [],
    defaultModel: "not set",
    fullscreenCopyOnSelect: true,
    fullscreenExitOutput: "transcript",
    fullscreenScrollbar: "auto",
    fullscreenWheelScrollLines: 7,
    modelThinkingLevels: {},
  } as unknown as SettingsConfig;
  const callbacks = {
    onFullscreenCopyOnSelectChange: onCopyOnSelectChange,
    onFullscreenExitOutputChange: onExitOutputChange,
    onFullscreenScrollbarChange: onScrollbarChange,
    onFullscreenWheelScrollLinesChange: onWheelScrollLinesChange,
  } as unknown as SettingsCallbacks;

  const cycle = (label: string, count: number) => {
    const list = new SettingsSelectorComponent(config, callbacks).getSettingsList();
    for (const character of label) list.handleInput(character);
    for (let i = 0; i < count; i++) list.handleInput("\r");
  };

  cycle("Fullscreen exit output", 2);
  expect(onExitOutputChange.mock.calls.flat()).toEqual(["resume-hint", "transcript"]);
  cycle("Fullscreen scrollbar", 3);
  expect(onScrollbarChange.mock.calls.flat()).toEqual(["always", "hidden", "auto"]);
  cycle("Fullscreen copy on select", 2);
  expect(onCopyOnSelectChange.mock.calls.flat()).toEqual([false, true]);

  cycle("Fullscreen wheel scrolling", 3);
  expect(onWheelScrollLinesChange.mock.calls.flat()).toEqual([10, "auto", 1]);
};

const keepsTheConfiguredFixedThemeMarkedWhile = () => {
  const config = {
    availableDefaultModels: [],
    availableThemes: ["system", "dark", "light"],
    currentTheme: "dark",
    defaultModel: "not set",
    modelThinkingLevels: {},
    terminalTheme: "dark",
  } as unknown as SettingsConfig;
  const callbacks = {
    onCancel: () => {},
    onThemePreview: vi.fn(),
  } as unknown as SettingsCallbacks;
  const list = new SettingsSelectorComponent(config, callbacks).getSettingsList();

  list.selectItem("theme");
  list.handleInput("\r");
  let output = stripAnsi(list.render(120).join("\n"));
  expect(output).toMatch(
    / {4}system +Theme created from your terminal's colors\n {4}automatic +Use separate themes/u,
  );
  expect(output).toContain("→ ✓ dark");

  list.handleInput("\x1b[B");
  output = stripAnsi(list.render(120).join("\n"));
  expect(output).toContain("  ✓ dark");
  expect(output).toContain("→   light");
};

const keepsAConfiguredAutomaticThemeMarkedWhile = () => {
  const config = {
    availableDefaultModels: [],
    availableThemes: ["dark", "light", "other"],
    currentTheme: "light/dark",
    defaultModel: "not set",
    modelThinkingLevels: {},
    terminalTheme: "dark",
  } as unknown as SettingsConfig;
  const callbacks = {
    onCancel: () => {},
    onThemePreview: vi.fn(),
  } as unknown as SettingsCallbacks;
  const list = new SettingsSelectorComponent(config, callbacks).getSettingsList();

  list.selectItem("theme");
  list.handleInput("\r");
  list.handleInput("\r");
  let output = stripAnsi(list.render(120).join("\n"));
  expect(output).toContain("→ ✓ light");

  list.handleInput("\x1b[B");
  output = stripAnsi(list.render(120).join("\n"));
  expect(output).toContain("  ✓ light");
  expect(output).toContain("→   other");
};

const keepsTheConfiguredPerModelThinkingLevel = () =>
  runTest(
    Effect.gen(function* () {
      harness = yield* awaited(
        createHarness({
          models: [{ id: "thinking-model", reasoning: true }],
        }),
      );
      const model = harness.getModel("thinking-model")!;
      const modelKey = `${model.provider}/${model.id}`;
      const config = {
        availableDefaultModels: [model],
        defaultModel: modelKey,
        modelThinkingLevels: { [modelKey]: "medium" },
        thinkingLevel: "high",
      } as unknown as SettingsConfig;
      const callbacks = { onCancel: () => {} } as unknown as SettingsCallbacks;
      const list = new SettingsSelectorComponent(config, callbacks).getSettingsList();

      list.selectItem("model-thinking");
      list.handleInput("\r");
      list.handleInput("\r");

      let output = stripAnsi(list.render(120).join("\n"));
      expect(output).toContain("→ ✓ medium");
      expect(output).toContain("    (clear override)");

      list.handleInput("\x1b[B");
      output = stripAnsi(list.render(120).join("\n"));
      expect(output).toContain("  ✓ medium");
      expect(output).toContain("→   high");
    }),
  );

describe("SettingsSelectorComponent", () => {
  beforeAll(() => {
    initTheme("dark");
    setKeybindings(new KeybindingsManager());
  });

  afterEach(() => {
    harness?.cleanup();
    harness = undefined;
  });

  it("cycles through fullscreen settings", cyclesThroughFullscreenSettings);

  it(
    "keeps the configured fixed theme marked while browsing",
    keepsTheConfiguredFixedThemeMarkedWhile,
  );

  it(
    "keeps a configured automatic theme marked while browsing",
    keepsAConfiguredAutomaticThemeMarkedWhile,
  );

  it(
    "keeps the configured per-model thinking level marked while browsing",
    keepsTheConfiguredPerModelThinkingLevel,
  );
});
