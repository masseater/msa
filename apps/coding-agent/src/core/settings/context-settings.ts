import type aiTypes from "@msa/ai/index.types";

import settingsDefaults from "../settings-defaults.ts";
import settingsManagerHelpers from "../settings-manager-helpers.ts";
import type SettingsManager from "../settings-manager.ts";
import type settingsSchemaTypes from "../settings-schema.types.ts";

const { DEFAULT_COMPACTION_TOKEN_SETTINGS, isMergeableObject } = settingsManagerHelpers;
const { SETTINGS_DEFAULTS } = settingsDefaults;

export default class ContextSettings {
  private readonly manager: SettingsManager;

  constructor(manager: SettingsManager) {
    this.manager = manager;
  }

  setMemoryRecallEnabled(enabled: boolean): void {
    if (this.manager.projectSettings.memory?.recall?.enabled !== undefined) {
      this.manager.persistence.updateProjectSettings("memory", (settings) => {
        settings.memory = { ...settings.memory, recall: { ...settings.memory?.recall, enabled } };
      });
      return;
    }
    this.manager.persistence.setNestedGlobalSetting("memory", "recall", {
      ...this.manager.globalSettings.memory?.recall,
      enabled,
    });
  }

  getCompactionEnabled(): boolean {
    return this.manager.settings.compaction?.enabled ?? SETTINGS_DEFAULTS.compaction.enabled;
  }

  getBranchSummarySettings(): { reserveTokens: number; skipPrompt: boolean } {
    return {
      reserveTokens:
        this.manager.settings.branchSummary?.reserveTokens ??
        SETTINGS_DEFAULTS.branchSummary.reserveTokens,
      skipPrompt:
        this.manager.settings.branchSummary?.skipPrompt ??
        SETTINGS_DEFAULTS.branchSummary.skipPrompt,
    };
  }

  getBranchSummarySkipPrompt(): boolean {
    return (
      this.manager.settings.branchSummary?.skipPrompt ?? SETTINGS_DEFAULTS.branchSummary.skipPrompt
    );
  }

  setCompactionEnabled(enabled: boolean): void {
    this.manager.persistence.setNestedGlobalSetting("compaction", "enabled", enabled);
  }

  private getCompactionTokenSetting(
    field: keyof settingsSchemaTypes.CompactionModelOverride,
    model?: Pick<aiTypes.Model<string>, "provider" | "id">,
  ): number {
    const compaction = this.manager.settings.compaction;
    const ordinary = compaction?.[field];
    if (
      ordinary !== undefined &&
      (typeof ordinary !== "number" || !Number.isSafeInteger(ordinary) || ordinary < 0)
    ) {
      throw new Error(
        `Invalid compaction.${field} setting: ${String(ordinary)}. Expected a non-negative safe integer.`,
      );
    }

    const modelKey = model === undefined ? undefined : `${model.provider}/${model.id}`;
    const entry =
      modelKey === undefined
        ? undefined
        : new Map(Object.entries(compaction?.modelOverrides ?? {})).get(modelKey);
    if (entry !== undefined && !isMergeableObject(entry)) {
      throw new Error(
        `Invalid compaction.modelOverrides["${modelKey}"] setting: ${String(entry)}. Expected an object.`,
      );
    }
    const override = entry?.[field];
    if (
      override !== undefined &&
      (typeof override !== "number" || !Number.isSafeInteger(override) || override < 0)
    ) {
      throw new Error(
        `Invalid compaction.modelOverrides["${modelKey}"].${field} setting: ${String(override)}. Expected a non-negative safe integer.`,
      );
    }
    return override ?? ordinary ?? DEFAULT_COMPACTION_TOKEN_SETTINGS[field];
  }

  getCompactionReserveTokens(model?: Pick<aiTypes.Model<string>, "provider" | "id">): number {
    return this.getCompactionTokenSetting("reserveTokens", model);
  }

  getCompactionKeepRecentTokens(model?: Pick<aiTypes.Model<string>, "provider" | "id">): number {
    return this.getCompactionTokenSetting("keepRecentTokens", model);
  }

  getCompactionSettings(model?: Pick<aiTypes.Model<string>, "provider" | "id">): {
    enabled: boolean;
    reserveTokens: number;
    keepRecentTokens: number;
  } {
    return {
      enabled: this.getCompactionEnabled(),
      keepRecentTokens: this.getCompactionKeepRecentTokens(model),
      reserveTokens: this.getCompactionReserveTokens(model),
    };
  }
}
