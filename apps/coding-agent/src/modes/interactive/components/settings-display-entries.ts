import type tuiTypes from "@msa/tui/index.types";

import type settingsManagerTypes from "../../../core/settings-manager.types.ts";
import settingEntry from "./setting-entry.ts";
import type settingsSelectorTypes from "./settings-selector.types.ts";

type Config = settingsSelectorTypes.SettingsConfig;
type SettingEntry = settingsSelectorTypes.SettingEntry;

const { choice, numeric, toggle } = settingEntry;

function imageEntries(config: Config, supportsImages: boolean): SettingEntry[] {
  const inlineImageEntries = [
    toggle(
      { description: "Render images inline in terminal", id: "show-images", label: "Show images" },
      config.showImages,
      (c, v) => c.onShowImagesChange(v),
    ),
    numeric(
      {
        description: "Preferred inline image width in terminal cells",
        id: "image-width-cells",
        label: "Image width",
      },
      config.imageWidthCells,
      ["60", "80", "120"],
      (c, v) => c.onImageWidthCellsChange(v),
    ),
  ];
  return [
    ...(supportsImages ? inlineImageEntries : []),
    toggle(
      {
        description: "Resize large images to 2000x2000 max for better model compatibility",
        id: "auto-resize-images",
        label: "Auto-resize images",
      },
      config.autoResizeImages,
      (c, v) => c.onAutoResizeImagesChange(v),
    ),
    toggle(
      {
        description: "Prevent images from being sent to LLM providers",
        id: "block-images",
        label: "Block images",
      },
      config.blockImages,
      (c, v) => c.onBlockImagesChange(v),
    ),
  ];
}

function editorEntries(config: Config): SettingEntry[] {
  return [
    toggle(
      {
        description: "Register skills as /name commands",
        id: "skill-commands",
        label: "Skill commands",
      },
      config.enableSkillCommands,
      (c, v) => c.onEnableSkillCommandsChange(v),
    ),
    toggle(
      {
        description: "Use the terminal cursor instead of msa's drawn cursor",
        id: "show-hardware-cursor",
        label: "Show hardware cursor",
      },
      config.showHardwareCursor,
      (c, v) => c.onShowHardwareCursorChange(v),
    ),
    numeric(
      {
        description: "Horizontal padding for input editor (0-3)",
        id: "editor-padding",
        label: "Editor padding",
      },
      config.editorPaddingX,
      ["0", "1", "2", "3"],
      (c, v) => c.onEditorPaddingXChange(v),
    ),
    {
      apply: (value, callbacks) => callbacks.onOutputPadChange(value === "0" ? 0 : 1),
      item: {
        currentValue: String(config.outputPad),
        description: "Horizontal padding for messages, tool output, and command output",
        id: "output-padding",
        label: "Output padding",
        values: ["0", "1"],
      },
    },
  ];
}

function terminalEntries(config: Config): SettingEntry[] {
  return [
    numeric(
      {
        description: "Max visible items in autocomplete dropdown (3-20)",
        id: "autocomplete-max-visible",
        label: "Autocomplete max items",
      },
      config.autocompleteMaxVisible,
      ["3", "5", "7", "10", "15", "20"],
      (c, v) => c.onAutocompleteMaxVisibleChange(v),
    ),
    toggle(
      {
        description: "Clear empty rows when content shrinks (may cause flicker)",
        id: "clear-on-shrink",
        label: "Clear on shrink",
      },
      config.clearOnShrink,
      (c, v) => c.onClearOnShrinkChange(v),
    ),
    toggle(
      {
        description: "Show OSC 9;4 progress indicators in the terminal tab bar",
        id: "terminal-progress",
        label: "Terminal progress",
      },
      config.showTerminalProgress,
      (c, v) => c.onShowTerminalProgressChange(v),
    ),
  ];
}

function inputDisplayEntries(config: Config, supportsImages: boolean): SettingEntry[] {
  return [
    ...imageEntries(config, supportsImages),
    ...editorEntries(config),
    ...terminalEntries(config),
  ];
}

function wheelScrollEntry(config: Config): SettingEntry {
  const presets = [...new Set([1, 2, 3, 5, 10, config.fullscreenWheelScrollLines])]
    .filter((lines) => lines !== "auto")
    .sort((a, b) => a - b)
    .map(String);
  return {
    apply: (value, callbacks) =>
      callbacks.onFullscreenWheelScrollLinesChange(value === "auto" ? "auto" : parseInt(value, 10)),
    item: {
      currentValue: String(config.fullscreenWheelScrollLines),
      description:
        "Lines per mouse-wheel event in fullscreen mode; 'auto' speeds up fast wheel spins where the terminal does not",
      id: "fullscreen-wheel-scroll-lines",
      label: "Fullscreen wheel scrolling",
      values: ["auto", ...presets],
    },
  };
}

function fullscreenEntries(config: Config): SettingEntry[] {
  return [
    choice<settingsManagerTypes.TuiMode>(
      {
        description: "Interface layout; regular mode uses the terminal's normal scrollback",
        id: "tui-mode",
        label: "TUI mode",
      },
      config.tuiMode,
      ["regular", "fullscreen"],
      (c, v) => c.onTuiModeChange(v),
    ),
    choice<settingsManagerTypes.FullscreenExitOutput>(
      {
        description:
          "Print the transcript or only a session resume hint when exiting fullscreen mode",
        id: "fullscreen-exit-output",
        label: "Fullscreen exit output",
      },
      config.fullscreenExitOutput,
      ["transcript", "resume-hint"],
      (c, v) => c.onFullscreenExitOutputChange(v),
    ),
    choice<tuiTypes.ScrollViewScrollbar>(
      {
        description: "Scrollbar behavior in fullscreen mode; has no effect in regular mode",
        id: "fullscreen-scrollbar",
        label: "Fullscreen scrollbar",
      },
      config.fullscreenScrollbar,
      ["auto", "always", "hidden"],
      (c, v) => c.onFullscreenScrollbarChange(v),
    ),
    toggle(
      {
        description:
          "Automatically copy selected text in fullscreen mode; disable to copy selections with Ctrl+X",
        id: "fullscreen-copy-on-select",
        label: "Fullscreen copy on select",
      },
      config.fullscreenCopyOnSelect,
      (c, v) => c.onFullscreenCopyOnSelectChange(v),
    ),
    wheelScrollEntry(config),
  ];
}

const settingsDisplayEntries = {
  fullscreenEntries,
  inputDisplayEntries,
};

export default settingsDisplayEntries;
