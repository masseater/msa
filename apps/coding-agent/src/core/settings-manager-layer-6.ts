import type aiTypes from "@msa/ai/index.types";

import config from "../config.ts";
import pathsModule from "../utils/paths.ts";
import FileSettingsStorage from "./file-settings-storage.ts";
import type memoryTypes from "./memory/memory.types.ts";
import platformNode from "./platform-node.ts";
import processEnv from "./process-env.ts";
import settingsDefaults from "./settings-defaults.ts";
import SettingsManagerLayer5 from "./settings-manager-layer-5.ts";
import SettingsManager from "./settings-manager.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";

const { CONFIG_DIR_NAME, getAgentDir } = config;
const { resolvePath } = pathsModule;
const { dirname, join } = platformNode;
const { SETTINGS_DEFAULTS } = settingsDefaults;
const { readEnv } = processEnv;

export default abstract class SettingsManagerLayer6 extends SettingsManagerLayer5 {
  static create(
    cwd: string,
    agentDir: string = getAgentDir(),
    options: settingsManagerTypes.SettingsManagerCreateOptions = {},
  ): SettingsManager {
    const resolvedCwd = resolvePath(cwd);
    const resolvedAgentDir = resolvePath(agentDir);
    const storage = new FileSettingsStorage(resolvedCwd, resolvedAgentDir);
    return SettingsManager.fromStorageWithPaths(storage, options, {
      global: join(resolvedAgentDir, "settings.json"),
      project: join(resolvedCwd, CONFIG_DIR_NAME, "settings.json"),
    });
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
    const memory = this.settings.memory;
    const defaults = SETTINGS_DEFAULTS.memory;
    const apiKeyEnv = memory?.embedding?.apiKeyEnv?.trim();
    const apiKey =
      apiKeyEnv !== undefined && apiKeyEnv !== "" ? readEnv(apiKeyEnv)?.trim() : undefined;
    const database = memory?.database?.trim();
    const timeoutMs = memory?.embedding?.timeoutMs;
    const limit = memory?.recall?.limit;
    const minScore = memory?.recall?.minScore;
    const agentDir =
      this.settingsPaths.global !== undefined && this.settingsPaths.global !== ""
        ? dirname(this.settingsPaths.global)
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
