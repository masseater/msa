import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import type tuiTypes from "@msa/tui/index.types";

import themeModule from "../theme/theme.ts";
import type settingsSelectorTypes from "./settings-selector.types.ts";
import type settingsSubmenuTypes from "./settings-submenu.types.ts";
import SteppedSubmenu from "./stepped-submenu.ts";

const { theme } = themeModule;

const MODEL_PICKER_LAYOUT = { maxPrimaryColumnWidth: 46, minPrimaryColumnWidth: 12 };
const CLEAR_OVERRIDE_VALUE = "__clear__";

const THINKING_DESCRIPTIONS: Record<agentTypes.ThinkingLevel, string> = {
  high: "Deep reasoning (~16k tokens)",
  low: "Light reasoning (~2k tokens)",
  max: "Maximum reasoning",
  medium: "Moderate reasoning (~8k tokens)",
  minimal: "Very brief reasoning (~1k tokens)",
  off: "No reasoning",
  xhigh: "Extra-high reasoning (~32k tokens)",
};

type Model = aiTypes.Model<any>;
type Done = (selectedValue?: string, options?: { navigateTo?: string }) => void;

function modelSettingKey(model: Model): string {
  return `${model.provider}/${model.id}`;
}

function overridesSummary(overrides: ReadonlyMap<string, agentTypes.ThinkingLevel>): string {
  const count = overrides.size;
  return count === 0 ? "none" : `${count} configured`;
}

export default class ModelThinkingSubmenu {
  private readonly levels: Map<string, agentTypes.ThinkingLevel>;
  private readonly modelsByKey: Map<string, Model>;
  private readonly currentModelKey: string | undefined;
  private readonly defaultModelKey: string | undefined;
  private readonly config: settingsSelectorTypes.SettingsConfig;

  constructor(config: settingsSelectorTypes.SettingsConfig) {
    this.config = config;
    this.levels = new Map(Object.entries(config.modelThinkingLevels));
    this.modelsByKey = new Map(
      config.availableDefaultModels.map((model) => [modelSettingKey(model), model]),
    );
    this.defaultModelKey = this.modelsByKey.has(config.defaultModel)
      ? config.defaultModel
      : undefined;
    this.currentModelKey =
      config.currentModel === undefined ? undefined : modelSettingKey(config.currentModel);
  }

  summary(): string {
    return overridesSummary(this.levels);
  }

  open(callbacks: settingsSelectorTypes.SettingsCallbacks, done: Done): SteppedSubmenu {
    return new SteppedSubmenu(
      this.steps(),
      (selections) => this.apply(selections, callbacks),
      () => done(this.summary()),
      { loop: true },
    );
  }

  private apply(
    selections: Record<string, string>,
    callbacks: settingsSelectorTypes.SettingsCallbacks,
  ): void {
    const modelKey = selections["model"];
    const model = modelKey === undefined ? undefined : this.modelsByKey.get(modelKey);
    if (modelKey === undefined || model === undefined) return;
    const level = selections["level"];
    if (level === CLEAR_OVERRIDE_VALUE) {
      callbacks.onModelThinkingLevelRemove(model.provider, model.id);
      this.levels.delete(modelKey);
      return;
    }
    callbacks.onModelThinkingLevelChange(
      model.provider,
      model.id,
      level as agentTypes.ThinkingLevel,
    );
    this.levels.set(modelKey, level as agentTypes.ThinkingLevel);
  }

  private steps(): settingsSubmenuTypes.SteppedSubmenuStep[] {
    return [
      {
        description: "Select a model to configure",
        key: "model",
        layout: MODEL_PICKER_LAYOUT,
        options: () => this.modelItems(),
        preselect: () => this.currentModelKey ?? this.defaultModelKey,
        searchable: true,
        title: "Per-Model Thinking Level",
      },
      {
        description: "Select default thinking level for this model",
        key: "level",
        options: (ctx) => this.levelItems(ctx["model"]),
        preselect: (ctx) => {
          const modelKey = ctx["model"];
          return modelKey === undefined ? undefined : this.levels.get(modelKey);
        },
        title: (ctx) => {
          const modelKey = ctx["model"];
          const model = modelKey === undefined ? undefined : this.modelsByKey.get(modelKey);
          return `Thinking Level for ${model === undefined ? modelKey : `${model.id} [${model.provider}]`}`;
        },
      },
    ];
  }

  private modelRank(model: Model): number {
    const key = modelSettingKey(model);
    if (key === this.currentModelKey) return 0;
    if (key === this.defaultModelKey) return 1;
    return 2;
  }

  private modelItems(): tuiTypes.SelectItem[] {
    const sorted = [...this.config.availableDefaultModels].sort(
      (a, b) => this.modelRank(a) - this.modelRank(b) || a.provider.localeCompare(b.provider),
    );
    const items = sorted.map((model): tuiTypes.SelectItem => {
      const key = modelSettingKey(model);
      const override = this.levels.get(key);
      const item: tuiTypes.SelectItem = {
        label: `${model.id} ${theme.fg("muted", `[${model.provider}]`)}`,
        value: key,
      };
      if (override !== undefined) item.description = override;
      return item;
    });
    if (items.length > 0) return items;
    return [
      {
        description: "Log in to a provider or configure an API key first",
        label: "No models available",
        value: "__none__",
      },
    ];
  }

  private levelItems(modelKey: string | undefined): tuiTypes.SelectItem[] {
    const model = modelKey === undefined ? undefined : this.modelsByKey.get(modelKey);
    if (modelKey === undefined || model === undefined) return [];
    const levels = (
      model.reasoning ? ai.getSupportedThinkingLevels(model) : ["off"]
    ) as agentTypes.ThinkingLevel[];
    const activeLevel = this.levels.get(modelKey);
    const items: tuiTypes.SelectItem[] = levels.map((level) => ({
      description: THINKING_DESCRIPTIONS[level],
      label: `${level === activeLevel ? "✓ " : "  "}${level}`,
      value: level,
    }));
    if (activeLevel !== undefined) {
      items.push({
        description: `Revert to global default (${this.config.thinkingLevel})`,
        label: "  (clear override)",
        value: CLEAR_OVERRIDE_VALUE,
      });
    }
    return items;
  }
}
