import httpDispatcher from "./http-dispatcher.ts";
import modelPolicyModule from "./model-policy.ts";
import type modelPolicyTypes from "./model-policy.types.ts";
import settingsDefaults from "./settings-defaults.ts";
import settingsManagerSupport from "./settings-manager-support.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";
import type settingsSchemaTypes from "./settings-schema.types.ts";

const { SETTINGS_DEFAULTS } = settingsDefaults;
const { DEFAULT_TOOL_NAMES, applyToolModifiers, isToolModifier } = settingsManagerSupport;
const { EMPTY_MODEL_POLICY } = modelPolicyModule;
const { parseHttpIdleTimeoutMs } = httpDispatcher;

const DEFAULT_COMPACTION_TOKEN_SETTINGS: Required<settingsSchemaTypes.CompactionModelOverride> = {
  keepRecentTokens: SETTINGS_DEFAULTS.compaction.keepRecentTokens,
  reserveTokens: SETTINGS_DEFAULTS.compaction.reserveTokens,
};

function isMergeableObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMergeObjects(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base };

  for (const key of Object.keys(overrides)) {
    const overrideValue = overrides[key];
    if (overrideValue === undefined) {
      continue;
    }

    const baseValue = base[key];
    result[key] =
      isMergeableObject(baseValue) && isMergeableObject(overrideValue)
        ? deepMergeObjects(baseValue, overrideValue)
        : overrideValue;
  }

  return result;
}

function mergeDefaultTools(
  base: string[] | undefined,
  overrides: string[] | undefined,
): string[] | undefined {
  if (overrides === undefined) return base;
  if (!Array.isArray(base) || !Array.isArray(overrides) || !overrides.every(isToolModifier))
    return overrides;
  return [...base, ...overrides];
}

function resolveDefaultTools(entries: string[]): string[] {
  const plain = entries.filter((entry) => !isToolModifier(entry));
  return applyToolModifiers(
    plain.length > 0 || entries.length === 0 ? plain : DEFAULT_TOOL_NAMES,
    entries,
  );
}

function deepMergeSettings(
  base: settingsSchemaTypes.Settings,
  overrides: settingsSchemaTypes.Settings,
): settingsSchemaTypes.Settings {
  const merged = deepMergeObjects(
    base as Record<string, unknown>,
    overrides as Record<string, unknown>,
  ) as settingsSchemaTypes.Settings;
  const defaultTools = mergeDefaultTools(base.defaultTools, overrides.defaultTools);
  return defaultTools === undefined ? merged : { ...merged, defaultTools };
}

function readModelPolicy(settings: settingsSchemaTypes.Settings): modelPolicyTypes.ModelPolicy {
  const policy = settings.modelPolicy;
  if (policy === undefined || typeof policy !== "object") return EMPTY_MODEL_POLICY;
  const patterns = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
      : [];
  return { allow: patterns(policy.allow), deny: patterns(policy.deny) };
}

function parseTimeoutSetting(value: unknown, settingName: string): number | undefined {
  const timeoutMs = parseHttpIdleTimeoutMs(value);
  if (timeoutMs !== undefined) {
    return timeoutMs;
  }
  if (value !== undefined) {
    throw new Error(`Invalid ${settingName} setting: ${String(value)}`);
  }
  return undefined;
}

const isSettingsRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const KEPT_RECALL_KEYS = new Set(["enabled"]);

function removedSettingNotices(settings: settingsSchemaTypes.Settings): string[] {
  const memory: unknown = settings.memory;
  if (!isSettingsRecord(memory)) return [];
  const notices: string[] = [];
  if (memory["database"] !== undefined)
    notices.push(
      "memory.database is read only to move its memories to sepiace once; remove it after the move.",
    );
  const embedding = memory["embedding"];
  const embeddingKeys = isSettingsRecord(embedding) ? Object.keys(embedding) : [];
  if (embedding !== undefined && embeddingKeys.length === 0) embeddingKeys.push("");
  for (const key of embeddingKeys)
    notices.push(
      `${key === "" ? "memory.embedding" : `memory.embedding.${key}`} is no longer used, because sepiace keeps memories; remove it.`,
    );
  const recall = memory["recall"];
  for (const key of isSettingsRecord(recall) ? Object.keys(recall) : [])
    if (!KEPT_RECALL_KEYS.has(key))
      notices.push(`memory.recall.${key} is no longer used, because sepiace recalls; remove it.`);
  return notices;
}

function toSettingsError(
  scope: settingsManagerTypes.SettingsScope,
  error: unknown,
  path?: string,
): settingsManagerTypes.SettingsError {
  return {
    scope,
    ...(path !== undefined && path !== "" ? { path } : {}),
    error: error instanceof Error ? error : new Error(String(error)),
  };
}

const settingsManagerHelpers = {
  DEFAULT_COMPACTION_TOKEN_SETTINGS,
  deepMergeObjects,
  deepMergeSettings,
  isMergeableObject,
  mergeDefaultTools,
  parseTimeoutSetting,
  readModelPolicy,
  removedSettingNotices,
  resolveDefaultTools,
  toSettingsError,
};

export default settingsManagerHelpers;
