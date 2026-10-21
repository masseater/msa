import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import httpDispatcher from "../../../core/http-dispatcher.ts";
import settingsManagerSupport from "../../../core/settings-manager-support.ts";
import type settingsManagerTypes from "../../../core/settings-manager.types.ts";
import themeModule from "../theme/theme.ts";
import DynamicBorder from "./dynamic-border.ts";
import keybindingHints from "./keybinding-hints.ts";
import type settingsSelectorTypes from "./settings-selector.types.ts";
import type settingsSubmenuTypes from "./settings-submenu.types.ts";
import SteppedSubmenu from "./stepped-submenu.ts";
import ThemeSubmenu from "./theme-submenu.ts";

const { CACHE_WARMING_MODES } = settingsManagerSupport;
const { getSettingsListTheme, theme } = themeModule;
const { keyDisplayText } = keybindingHints;
const { HTTP_IDLE_TIMEOUT_CHOICES, formatHttpIdleTimeoutMs } = httpDispatcher;
const { getSupportedThinkingLevels } = ai;

const { SettingsList, getCapabilities } = tui;

const MODEL_PICKER_LAYOUT = { maxPrimaryColumnWidth: 46, minPrimaryColumnWidth: 12 };

const THINKING_DESCRIPTIONS: Record<agentTypes.ThinkingLevel, string> = {
  high: "Deep reasoning (~16k tokens)",
  low: "Light reasoning (~2k tokens)",
  max: "Maximum reasoning",
  medium: "Moderate reasoning (~8k tokens)",
  minimal: "Very brief reasoning (~1k tokens)",
  off: "No reasoning",
  xhigh: "Extra-high reasoning (~32k tokens)",
};

const DEFAULT_PROJECT_TRUST_LABELS: Record<settingsManagerTypes.DefaultProjectTrust, string> = {
  always: "Always trust",
  ask: "Ask",
  never: "Never trust",
};

const DEFAULT_PROJECT_TRUST_BY_LABEL = new Map(
  Object.entries(DEFAULT_PROJECT_TRUST_LABELS).map(([value, label]) => [
    label,
    value as settingsManagerTypes.DefaultProjectTrust,
  ]),
);

const CLEAR_OVERRIDE_VALUE = "__clear__";

function modelSettingKey(model: aiTypes.Model<any>): string {
  return `${model.provider}/${model.id}`;
}

function modelDisplayLabel(model: aiTypes.Model<any>): string {
  return `${model.id} [${model.provider}]`;
}

function modelThinkingOverridesSummary(
  overrides: Record<string, agentTypes.ThinkingLevel>,
): string {
  const count = Object.keys(overrides).length;
  if (count === 0) return "none";
  return `${count} configured`;
}

function modelItemLabel(model: aiTypes.Model<any>): string {
  return `${model.id} ${theme.fg("muted", `[${model.provider}]`)}`;
}

function selectionContext(config: settingsSelectorTypes.SettingsConfig) {
  const supportsImages = getCapabilities().images;
  const followUpKey = keyDisplayText("app.message.followUp");
  const cycleThinkingKey = keyDisplayText("app.thinking.cycle");
  const currentModelThinkingLevels = { ...config.modelThinkingLevels };
  const defaultModelByValue = new Map(
    config.availableDefaultModels.map((model) => [modelSettingKey(model), model]),
  );
  const currentDefaultModelKey = defaultModelByValue.has(config.defaultModel)
    ? config.defaultModel
    : undefined;
  const currentModelKey =
    config.currentModel === undefined ? undefined : modelSettingKey(config.currentModel);
  return {
    currentDefaultModelKey,
    currentModelKey,
    currentModelThinkingLevels,
    cycleThinkingKey,
    defaultModelByValue,
    followUpKey,
    supportsImages,
  };
}

export default class SettingsSelectorComponent extends tui.Container {
  private settingsList: tuiTypes.SettingsList;

  constructor(
    config: settingsSelectorTypes.SettingsConfig,
    callbacks: settingsSelectorTypes.SettingsCallbacks,
  ) {
    super();

    const {
      followUpKey,
      currentModelThinkingLevels,
      cycleThinkingKey,
      currentModelKey,
      currentDefaultModelKey,
      defaultModelByValue,
      supportsImages,
    } = selectionContext(config);

    const items: tuiTypes.SettingItem[] = [
      {
        currentValue: config.autoCompact ? "true" : "false",
        description: "Automatically compact context when it gets too large",
        id: "autocompact",
        label: "Auto-compact",
        values: ["true", "false"],
      },
      {
        currentValue: config.steeringMode,
        description:
          "Enter while streaming queues steering messages. 'one-at-a-time': deliver one, wait for response. 'all': deliver all at once.",
        id: "steering-mode",
        label: "Steering mode",
        values: ["one-at-a-time", "all"],
      },
      {
        currentValue: config.followUpMode,
        description: `${followUpKey} queues follow-up messages until agent stops. 'one-at-a-time': deliver one, wait for response. 'all': deliver all at once.`,
        id: "follow-up-mode",
        label: "Follow-up mode",
        values: ["one-at-a-time", "all"],
      },
      {
        currentValue: config.transport,
        description: "Preferred transport for providers that support multiple transports",
        id: "transport",
        label: "Transport",
        values: ["sse", "websocket", "websocket-cached", "auto"],
      },
      {
        currentValue: formatHttpIdleTimeoutMs(config.httpIdleTimeoutMs),
        description:
          "Maximum idle gap while waiting for HTTP headers or body chunks. Disable for local models that pause longer than five minutes.",
        id: "http-idle-timeout",
        label: "HTTP idle timeout",
        values: HTTP_IDLE_TIMEOUT_CHOICES.map((choice) => choice.label),
      },
      {
        currentValue: config.cacheWarmingMode,
        description:
          "off; streaming while the agent runs; idle also between runs while continuation stays profitable",
        id: "cache-warming-mode",
        label: "Cache warming",
        values: [...CACHE_WARMING_MODES],
      },
      {
        currentValue: config.hideThinkingBlock ? "true" : "false",
        description: "Hide thinking blocks in assistant responses",
        id: "hide-thinking",
        label: "Hide thinking",
        values: ["true", "false"],
      },
      {
        currentValue: config.mermaidRenderingMode,
        description: "Render Mermaid code blocks as Unicode diagrams",
        id: "mermaid-rendering",
        label: "Mermaid diagrams",
        values: ["off", "final", "streaming"],
      },
      {
        currentValue: config.showCacheMissNotices ? "true" : "false",
        description: "Show transcript notices for cache costs and provider recovery diagnostics",
        id: "cache-miss-notices",
        label: "Cache miss notices",
        values: ["true", "false"],
      },
      {
        currentValue: config.collapseChangelog ? "true" : "false",
        description: "Show condensed changelog after updates",
        id: "collapse-changelog",
        label: "Collapse changelog",
        values: ["true", "false"],
      },
      {
        currentValue: String(config.quietStartup),
        description: "Disable verbose printing at startup (header: keep only the startup header)",
        id: "quiet-startup",
        label: "Quiet startup",
        values: ["true", "header", "false"],
      },
      {
        currentValue: config.enableInstallTelemetry ? "true" : "false",
        description: "Send attribution headers to OpenRouter",
        id: "install-telemetry",
        label: "Provider attribution",
        values: ["true", "false"],
      },
      {
        currentValue: DEFAULT_PROJECT_TRUST_LABELS[config.defaultProjectTrust],
        description:
          "Fallback behavior when no extension or saved trust decision decides project trust",
        id: "default-project-trust",
        label: "Default project trust",
        values: Object.values(DEFAULT_PROJECT_TRUST_LABELS),
      },
      {
        currentValue: config.doubleEscapeAction,
        description: "Action when pressing Escape twice with empty editor",
        id: "double-escape-action",
        label: "Double-escape action",
        values: ["tree", "fork", "none"],
      },
      {
        currentValue: config.treeFilterMode,
        description: "Default filter when opening /rewind",
        id: "tree-filter-mode",
        label: "Tree filter mode",
        values: ["default", "no-tools", "user-only", "labeled-only", "all"],
      },
      {
        currentValue: modelThinkingOverridesSummary(currentModelThinkingLevels),
        description: `Override the default thinking level for specific models. ${cycleThinkingKey} cycles in-session.`,
        id: "model-thinking",
        label: "Default thinking level per model",
        submenu: (_currentValue, done) =>
          this.modelThinkingSubmenu(
            config,
            currentModelKey,
            currentDefaultModelKey,
            currentModelThinkingLevels,
            defaultModelByValue,
            callbacks,
            done,
          ),
      },
      {
        currentValue: config.tuiMode,
        description: "Interface layout; regular mode uses the terminal's normal scrollback",
        id: "tui-mode",
        label: "TUI mode",
        values: ["regular", "fullscreen"],
      },
      {
        currentValue: config.fullscreenExitOutput,
        description:
          "Print the transcript or only a session resume hint when exiting fullscreen mode",
        id: "fullscreen-exit-output",
        label: "Fullscreen exit output",
        values: ["transcript", "resume-hint"],
      },
      {
        currentValue: config.fullscreenScrollbar,
        description: "Scrollbar behavior in fullscreen mode; has no effect in regular mode",
        id: "fullscreen-scrollbar",
        label: "Fullscreen scrollbar",
        values: ["auto", "always", "hidden"],
      },
      {
        currentValue: config.fullscreenCopyOnSelect ? "true" : "false",
        description:
          "Automatically copy selected text in fullscreen mode; disable to copy selections with Ctrl+X",
        id: "fullscreen-copy-on-select",
        label: "Fullscreen copy on select",
        values: ["true", "false"],
      },
      {
        currentValue: String(config.fullscreenWheelScrollLines),
        description:
          "Lines per mouse-wheel event in fullscreen mode; 'auto' speeds up fast wheel spins where the terminal does not",
        id: "fullscreen-wheel-scroll-lines",
        label: "Fullscreen wheel scrolling",
        values: [
          "auto",
          ...[...new Set([1, 2, 3, 5, 10, config.fullscreenWheelScrollLines])]
            .filter((lines) => lines !== "auto")
            .sort((a, b) => a - b)
            .map(String),
        ],
      },
      {
        currentValue: config.currentTheme,
        description: "Color theme for the interface",
        id: "theme",
        label: "Theme",
        submenu: (currentValue, done) =>
          new ThemeSubmenu(
            currentValue,
            config.terminalTheme,
            config.availableThemes,
            callbacks,
            done,
          ),
      },
    ];

    const outputPaddingIndex = insertImageItems(supportsImages, items, config);
    insertTerminalItems(items, outputPaddingIndex, config);
    this.addChild(new DynamicBorder());

    this.settingsList = new SettingsList(
      items,
      10,
      getSettingsListTheme(),
      (id, newValue) => {
        switch (id) {
          case "autocompact":
            callbacks.onAutoCompactChange(newValue === "true");
            break;
          case "show-images":
            callbacks.onShowImagesChange(newValue === "true");
            break;
          case "image-width-cells":
            callbacks.onImageWidthCellsChange(parseInt(newValue, 10));
            break;
          case "auto-resize-images":
            callbacks.onAutoResizeImagesChange(newValue === "true");
            break;
          case "block-images":
            callbacks.onBlockImagesChange(newValue === "true");
            break;
          case "skill-commands":
            callbacks.onEnableSkillCommandsChange(newValue === "true");
            break;
          case "steering-mode":
            callbacks.onSteeringModeChange(newValue as "all" | "one-at-a-time");
            break;
          case "follow-up-mode":
            callbacks.onFollowUpModeChange(newValue as "all" | "one-at-a-time");
            break;
          case "transport":
            callbacks.onTransportChange(newValue as aiTypes.Transport);
            break;
          case "http-idle-timeout": {
            const choice = HTTP_IDLE_TIMEOUT_CHOICES.find((item) => item.label === newValue);
            if (choice !== undefined) {
              callbacks.onHttpIdleTimeoutMsChange(choice.timeoutMs);
            }
            break;
          }
          case "cache-warming-mode":
            callbacks.onCacheWarmingModeChange(newValue as settingsManagerTypes.CacheWarmingMode);
            break;
          case "hide-thinking":
            callbacks.onHideThinkingBlockChange(newValue === "true");
            break;
          case "mermaid-rendering":
            callbacks.onMermaidRenderingModeChange(
              newValue as settingsManagerTypes.MermaidRenderingMode,
            );
            break;
          case "cache-miss-notices":
            callbacks.onShowCacheMissNoticesChange(newValue === "true");
            break;
          case "collapse-changelog":
            callbacks.onCollapseChangelogChange(newValue === "true");
            break;
          case "quiet-startup":
            callbacks.onQuietStartupChange(newValue === "header" ? "header" : newValue === "true");
            break;
          case "install-telemetry":
            callbacks.onEnableInstallTelemetryChange(newValue === "true");
            break;
          case "default-project-trust": {
            const defaultProjectTrust = DEFAULT_PROJECT_TRUST_BY_LABEL.get(newValue);
            if (defaultProjectTrust !== undefined) {
              callbacks.onDefaultProjectTrustChange(defaultProjectTrust);
            }
            break;
          }
          case "double-escape-action":
            callbacks.onDoubleEscapeActionChange(newValue as "fork" | "tree");
            break;
          case "tree-filter-mode":
            callbacks.onTreeFilterModeChange(
              newValue as "default" | "no-tools" | "user-only" | "labeled-only" | "all",
            );
            break;
          case "show-hardware-cursor":
            callbacks.onShowHardwareCursorChange(newValue === "true");
            break;
          case "editor-padding":
            callbacks.onEditorPaddingXChange(parseInt(newValue, 10));
            break;
          case "output-padding":
            callbacks.onOutputPadChange(newValue === "0" ? 0 : 1);
            break;
          case "autocomplete-max-visible":
            callbacks.onAutocompleteMaxVisibleChange(parseInt(newValue, 10));
            break;
          case "clear-on-shrink":
            callbacks.onClearOnShrinkChange(newValue === "true");
            break;
          case "terminal-progress":
            callbacks.onShowTerminalProgressChange(newValue === "true");
            break;
          case "tui-mode":
            callbacks.onTuiModeChange(newValue as settingsManagerTypes.TuiMode);
            break;
          case "fullscreen-exit-output":
            callbacks.onFullscreenExitOutputChange(
              newValue as settingsManagerTypes.FullscreenExitOutput,
            );
            break;
          case "fullscreen-scrollbar":
            callbacks.onFullscreenScrollbarChange(newValue as tuiTypes.ScrollViewScrollbar);
            break;
          case "fullscreen-copy-on-select":
            callbacks.onFullscreenCopyOnSelectChange(newValue === "true");
            break;
          case "fullscreen-wheel-scroll-lines":
            callbacks.onFullscreenWheelScrollLinesChange(
              newValue === "auto" ? "auto" : parseInt(newValue, 10),
            );
            break;
          case "theme":
            callbacks.onThemeChange(newValue);
            break;
        }
      },
      callbacks.onCancel,
      { enableSearch: true },
    );

    this.addChild(this.settingsList);
    this.addChild(new DynamicBorder());
  }

  private modelThinkingSubmenu(
    config: settingsSelectorTypes.SettingsConfig,
    currentModelKey: string | undefined,
    currentDefaultModelKey: string | undefined,
    currentModelThinkingLevels: { [x: string]: agentTypes.ThinkingLevel },
    defaultModelByValue: Map<string, aiTypes.Model<any>>,
    callbacks: settingsSelectorTypes.SettingsCallbacks,
    done: (selectedValue?: string, options?: { navigateTo?: string }) => void,
  ) {
    const steps: settingsSubmenuTypes.SteppedSubmenuStep[] = this.modelThinkingSteps(
      config,
      currentModelKey,
      currentDefaultModelKey,
      currentModelThinkingLevels,
      defaultModelByValue,
    );

    return this.steppedThinkingSubmenu(
      currentModelThinkingLevels,
      steps,
      defaultModelByValue,
      callbacks,
      done,
    );
  }

  private modelThinkingSteps(
    config: settingsSelectorTypes.SettingsConfig,
    currentModelKey: string | undefined,
    currentDefaultModelKey: string | undefined,
    currentModelThinkingLevels: { [x: string]: agentTypes.ThinkingLevel },
    defaultModelByValue: Map<string, aiTypes.Model<any>>,
  ): settingsSubmenuTypes.SteppedSubmenuStep[] {
    return [
      {
        description: "Select a model to configure",
        key: "model",
        layout: MODEL_PICKER_LAYOUT,
        options: () =>
          this.modelPickerItems(
            config,
            currentModelKey,
            currentDefaultModelKey,
            currentModelThinkingLevels,
          ),
        preselect: () => currentModelKey ?? currentDefaultModelKey,
        searchable: true,
        title: "Per-Model Thinking Level",
      },
      {
        description: "Select default thinking level for this model",
        key: "level",
        options: (ctx) => {
          const modelKey = ctx["model"];
          if (modelKey === undefined) return [];
          const model = defaultModelByValue.get(modelKey);
          if (model === undefined) return [];
          return this.thinkingLevelItems(model, currentModelThinkingLevels, modelKey, config);
        },
        preselect: (ctx) => {
          const modelKey = ctx["model"];
          return modelKey === undefined ? undefined : currentModelThinkingLevels[modelKey];
        },
        title: (ctx) => {
          const modelKey = ctx["model"];
          const m = modelKey === undefined ? undefined : defaultModelByValue.get(modelKey);
          return `Thinking Level for ${m === undefined ? ctx["model"] : modelDisplayLabel(m)}`;
        },
      },
    ];
  }

  private thinkingLevelItems(
    model: aiTypes.Model<any>,
    currentModelThinkingLevels: { [x: string]: agentTypes.ThinkingLevel },
    modelKey: string,
    config: settingsSelectorTypes.SettingsConfig,
  ) {
    const levels = (
      model.reasoning ? getSupportedThinkingLevels(model) : ["off"]
    ) as agentTypes.ThinkingLevel[];
    const levelItems: tuiTypes.SelectItem[] = this.thinkingLevelChoices(
      currentModelThinkingLevels,
      modelKey,
      levels,
      config,
    );
    return levelItems;
  }

  private thinkingLevelChoices(
    currentModelThinkingLevels: { [x: string]: agentTypes.ThinkingLevel },
    modelKey: string,
    levels: agentTypes.ThinkingLevel[],
    config: settingsSelectorTypes.SettingsConfig,
  ) {
    const activeLevel = currentModelThinkingLevels[modelKey];
    const levelItems: tuiTypes.SelectItem[] = levels.map((level) => ({
      description: THINKING_DESCRIPTIONS[level],
      label: `${level === activeLevel ? "✓ " : "  "}${level}`,
      value: level,
    }));
    if (currentModelThinkingLevels[modelKey] !== undefined) {
      levelItems.push({
        description: `Revert to global default (${config.thinkingLevel})`,
        label: "  (clear override)",
        value: CLEAR_OVERRIDE_VALUE,
      });
    }
    return levelItems;
  }

  private modelPickerItems(
    config: settingsSelectorTypes.SettingsConfig,
    currentModelKey: string | undefined,
    currentDefaultModelKey: string | undefined,
    currentModelThinkingLevels: { [x: string]: agentTypes.ThinkingLevel },
  ) {
    const sorted = [...config.availableDefaultModels].sort((a, b) => {
      const aKey = modelSettingKey(a);
      const bKey = modelSettingKey(b);
      if (aKey === currentModelKey) return -1;
      if (bKey === currentModelKey) return 1;
      if (aKey === currentDefaultModelKey) return -1;
      if (bKey === currentDefaultModelKey) return 1;
      return a.provider.localeCompare(b.provider);
    });
    const modelItems: tuiTypes.SelectItem[] = sorted.map((model) => {
      const key = modelSettingKey(model);
      const override = currentModelThinkingLevels[key];
      const item: tuiTypes.SelectItem = { label: modelItemLabel(model), value: key };
      if (override !== undefined) item.description = override;
      return item;
    });
    if (modelItems.length === 0) {
      modelItems.push({
        description: "Log in to a provider or configure an API key first",
        label: "No models available",
        value: "__none__",
      });
    }
    return modelItems;
  }

  private steppedThinkingSubmenu(
    currentModelThinkingLevels: { [x: string]: agentTypes.ThinkingLevel },
    steps: settingsSubmenuTypes.SteppedSubmenuStep[],
    defaultModelByValue: Map<string, aiTypes.Model<any>>,
    callbacks: settingsSelectorTypes.SettingsCallbacks,
    done: (selectedValue?: string, options?: { navigateTo?: string }) => void,
  ) {
    const summary = () => modelThinkingOverridesSummary(currentModelThinkingLevels);

    return new SteppedSubmenu(
      steps,
      (selections) => {
        const modelKey = selections["model"];
        if (modelKey === undefined) return;
        const model = defaultModelByValue.get(modelKey);
        if (model === undefined) return;
        if (selections["level"] === CLEAR_OVERRIDE_VALUE) {
          callbacks.onModelThinkingLevelRemove(model.provider, model.id);
          delete currentModelThinkingLevels[modelKey];
        } else {
          callbacks.onModelThinkingLevelChange(
            model.provider,
            model.id,
            selections["level"] as agentTypes.ThinkingLevel,
          );
          currentModelThinkingLevels[modelKey] = selections["level"] as agentTypes.ThinkingLevel;
        }
      },
      () => {
        done(summary());
      },
      { loop: true },
    );
  }

  getSettingsList(): tuiTypes.SettingsList {
    return this.settingsList;
  }
}

function insertImageItems(
  supportsImages: string | null,
  items: tuiTypes.SettingItem[],
  config: settingsSelectorTypes.SettingsConfig,
) {
  if (supportsImages !== null) {
    items.splice(1, 0, {
      currentValue: config.showImages ? "true" : "false",
      description: "Render images inline in terminal",
      id: "show-images",
      label: "Show images",
      values: ["true", "false"],
    });
    items.splice(2, 0, {
      currentValue: String(config.imageWidthCells),
      description: "Preferred inline image width in terminal cells",
      id: "image-width-cells",
      label: "Image width",
      values: ["60", "80", "120"],
    });
  }

  items.splice(supportsImages === null ? 1 : 3, 0, {
    currentValue: config.autoResizeImages ? "true" : "false",
    description: "Resize large images to 2000x2000 max for better model compatibility",
    id: "auto-resize-images",
    label: "Auto-resize images",
    values: ["true", "false"],
  });

  const autoResizeIndex = items.findIndex((item) => item.id === "auto-resize-images");
  items.splice(autoResizeIndex + 1, 0, {
    currentValue: config.blockImages ? "true" : "false",
    description: "Prevent images from being sent to LLM providers",
    id: "block-images",
    label: "Block images",
    values: ["true", "false"],
  });

  const blockImagesIndex = items.findIndex((item) => item.id === "block-images");
  return insertEditorItems(items, blockImagesIndex, config);
}

function insertEditorItems(
  items: tuiTypes.SettingItem[],
  blockImagesIndex: number,
  config: settingsSelectorTypes.SettingsConfig,
): number {
  items.splice(blockImagesIndex + 1, 0, {
    currentValue: config.enableSkillCommands ? "true" : "false",
    description: "Register skills as /name commands",
    id: "skill-commands",
    label: "Skill commands",
    values: ["true", "false"],
  });

  const skillCommandsIndex = items.findIndex((item) => item.id === "skill-commands");
  items.splice(skillCommandsIndex + 1, 0, {
    currentValue: config.showHardwareCursor ? "true" : "false",
    description: "Use the terminal cursor instead of msa's drawn cursor",
    id: "show-hardware-cursor",
    label: "Show hardware cursor",
    values: ["true", "false"],
  });

  const hardwareCursorIndex = items.findIndex((item) => item.id === "show-hardware-cursor");
  items.splice(hardwareCursorIndex + 1, 0, {
    currentValue: String(config.editorPaddingX),
    description: "Horizontal padding for input editor (0-3)",
    id: "editor-padding",
    label: "Editor padding",
    values: ["0", "1", "2", "3"],
  });

  const editorPaddingIndex = items.findIndex((item) => item.id === "editor-padding");
  items.splice(editorPaddingIndex + 1, 0, {
    currentValue: String(config.outputPad),
    description: "Horizontal padding for messages, tool output, and command output",
    id: "output-padding",
    label: "Output padding",
    values: ["0", "1"],
  });

  const outputPaddingIndex = items.findIndex((item) => item.id === "output-padding");
  return outputPaddingIndex;
}

function insertTerminalItems(
  items: tuiTypes.SettingItem[],
  outputPaddingIndex: number,
  config: settingsSelectorTypes.SettingsConfig,
): void {
  items.splice(outputPaddingIndex + 1, 0, {
    currentValue: String(config.autocompleteMaxVisible),
    description: "Max visible items in autocomplete dropdown (3-20)",
    id: "autocomplete-max-visible",
    label: "Autocomplete max items",
    values: ["3", "5", "7", "10", "15", "20"],
  });

  const autocompleteIndex = items.findIndex((item) => item.id === "autocomplete-max-visible");
  items.splice(autocompleteIndex + 1, 0, {
    currentValue: config.clearOnShrink ? "true" : "false",
    description: "Clear empty rows when content shrinks (may cause flicker)",
    id: "clear-on-shrink",
    label: "Clear on shrink",
    values: ["true", "false"],
  });

  const clearOnShrinkIndex = items.findIndex((item) => item.id === "clear-on-shrink");
  items.splice(clearOnShrinkIndex + 1, 0, {
    currentValue: config.showTerminalProgress ? "true" : "false",
    description: "Show OSC 9;4 progress indicators in the terminal tab bar",
    id: "terminal-progress",
    label: "Terminal progress",
    values: ["true", "false"],
  });
}
