import type aiTypes from "@msa/ai/index.types";

import config from "../../config.ts";
import pathsModule from "../../utils/paths.ts";
import type memoryTypes from "../memory/memory.types.ts";
import platformNode from "../platform-node.ts";
import processEnv from "../process-env.ts";
import settingsDefaults from "../settings-defaults.ts";
import settingsManagerHelpers from "../settings-manager-helpers.ts";
import type SettingsManager from "../settings-manager.ts";
import type settingsSchemaTypes from "../settings-schema.types.ts";

const { DEFAULT_COMPACTION_TOKEN_SETTINGS, isMergeableObject } = settingsManagerHelpers;
const { SETTINGS_DEFAULTS } = settingsDefaults;
const { resolvePath } = pathsModule;
const { readEnv } = processEnv;
const { dirname, join } = platformNode;
const { getAgentDir } = config;

export default class ContextSettings {
  private readonly manager: SettingsManager;

  constructor(manager: SettingsManager) {
    this.manager = manager;
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
    const entry = modelKey === undefined ? undefined : compaction?.modelOverrides?.[modelKey];
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

  getMemorySettings(): memoryTypes.ResolvedMemorySettings {
    const memory = this.manager.settings.memory;
    const defaults = SETTINGS_DEFAULTS.memory;
    const apiKeyEnv = memory?.embedding?.apiKeyEnv?.trim();
    const apiKey =
      apiKeyEnv !== undefined && apiKeyEnv !== "" ? readEnv(apiKeyEnv)?.trim() : undefined;
    const database = memory?.database?.trim();
    const timeoutMs = memory?.embedding?.timeoutMs;
    const limit = memory?.recall?.limit;
    const minScore = memory?.recall?.minScore;
    const agentDir =
      this.manager.settingsPaths.global !== undefined && this.manager.settingsPaths.global !== ""
        ? dirname(this.manager.settingsPaths.global)
        : getAgentDir();
    return {
      database:
        database !== undefined && database !== ""
          ? resolvePath(database, agentDir)
          : join(agentDir, "memory.db"),
      embedding: {
        baseUrl: memory?.embedding?.baseUrl?.trim() || defaults.embedding.baseUrl,
        documentPrefix: memory?.embedding?.documentPrefix ?? defaults.embedding.documentPrefix,
        enabled: memory?.embedding?.enabled ?? defaults.embedding.enabled,
        model: memory?.embedding?.model?.trim() || defaults.embedding.model,
        queryPrefix: memory?.embedding?.queryPrefix ?? defaults.embedding.queryPrefix,
        ...(apiKey !== undefined && apiKey !== "" ? { apiKey } : {}),
        timeoutMs:
          typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs >= 0
            ? timeoutMs
            : defaults.embedding.timeoutMs,
      },
      enabled: memory?.enabled ?? defaults.enabled,
      recall: {
        enabled: memory?.recall?.enabled ?? defaults.recall.enabled,
        limit:
          typeof limit === "number" && Number.isFinite(limit) && limit >= 1
            ? Math.floor(limit)
            : defaults.recall.limit,
        minScore:
          typeof minScore === "number" && Number.isFinite(minScore)
            ? Math.min(1, Math.max(0, minScore))
            : defaults.recall.minScore,
      },
    };
  }
}
