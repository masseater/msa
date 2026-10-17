import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

import type { ThinkingLevel } from "@msa/agent-core";
import type { Model } from "@msa/ai";
import type { ScrollViewScrollbar, TerminalCapabilities, WheelScrollLines } from "@msa/tui";
import lockfile from "proper-lockfile";

import { CONFIG_DIR_NAME, getAgentDir } from "../config.ts";
import { normalizePath, resolvePath } from "../utils/paths.ts";
import { stripBom } from "../utils/text.ts";
import { DEFAULT_HTTP_IDLE_TIMEOUT_MS, parseHttpIdleTimeoutMs } from "./http-dispatcher.ts";
import type { ResolvedMemorySettings } from "./memory/memory.ts";
import { SETTINGS_DEFAULTS } from "./settings-defaults.ts";
import type {
  CacheWarmingMode,
  CompactionModelOverride,
  DefaultProjectTrust,
  FullscreenExitOutput,
  MermaidRenderingMode,
  PackageSource,
  QuietStartup,
  SessionShareDestination,
  Settings,
  ThinkingBudgetsSettings,
  TransportSetting,
  TuiMode,
  WarningSettings,
} from "./settings-schema.ts";

export type {
  BranchSummarySettings,
  CacheWarmingMode,
  CodemodeMode,
  CodemodeSettings,
  CompactionModelOverride,
  CompactionSettings,
  DefaultProjectTrust,
  FullscreenExitOutput,
  ImageSettings,
  MarkdownSettings,
  MemorySettings,
  MermaidRenderingMode,
  PackageSource,
  ProviderRetrySettings,
  QuietStartup,
  RetrySettings,
  SessionShareDestination,
  Settings,
  TerminalSettings,
  ThinkingBudgetsSettings,
  TransportSetting,
  TuiMode,
  WarningSettings,
} from "./settings-schema.ts";
/** Cache-warming profile. "idle" also warms between agent runs. */
export const CACHE_WARMING_MODES = [
  "off",
  "streaming",
  "idle",
] as const satisfies readonly CacheWarmingMode[];

const DEFAULT_COMPACTION_TOKEN_SETTINGS: Required<CompactionModelOverride> = {
  reserveTokens: SETTINGS_DEFAULTS.compaction.reserveTokens,
  keepRecentTokens: SETTINGS_DEFAULTS.compaction.keepRecentTokens,
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

/**
 * Tools enabled at startup when `defaultTools` does not change them. `web_search` and `web_fetch`
 * exist only when the `treg` CLI is installed; otherwise their names are ignored.
 */
export const DEFAULT_TOOL_NAMES: readonly string[] = [
  "read",
  "bash",
  "edit",
  "write",
  "memory",
  "web_search",
  "web_fetch",
];

/** Whether a tool selection entry is a `+name` or `-name` modifier. */
export function isToolModifier(entry: unknown): boolean {
  return typeof entry === "string" && (entry.startsWith("+") || entry.startsWith("-"));
}

/**
 * Validate a tool list from `--tools` or the SDK `tools` option. It is either an allowlist of plain
 * names and patterns or a list of only `+name`/`-name` entries with exact names. Returns the
 * problem, or undefined when the list is valid.
 */
export function getToolListError(entries: readonly string[]): string | undefined {
  const modifiers = entries.filter(isToolModifier);
  if (modifiers.length === 0) return undefined;
  if (modifiers.length < entries.length)
    return "tool names cannot be mixed with +name or -name entries";
  const pattern = modifiers.find((entry) => entry.includes("*"));
  if (pattern) return `+name and -name entries take exact tool names, not patterns: ${pattern}`;
  return undefined;
}

/**
 * Apply the `+name` and `-name` entries of `entries` to `base` in order: `+name` adds a tool and
 * `-name` removes one. Other entries are ignored.
 */
export function applyToolModifiers(base: readonly string[], entries: readonly string[]): string[] {
  const tools = [...base];
  for (const entry of entries) {
    if (!isToolModifier(entry)) continue;
    const name = entry.slice(1);
    const index = tools.indexOf(name);
    if (entry.startsWith("+") && index === -1 && name) tools.push(name);
    else if (entry.startsWith("-") && index !== -1) tools.splice(index, 1);
  }
  return tools;
}

/**
 * Merge `defaultTools` of two settings layers. A list with plain tool names replaces the inherited
 * one; a list of only `+name`/`-name` entries is appended, so it modifies the inherited selection.
 */
function mergeDefaultTools(
  base: string[] | undefined,
  overrides: string[] | undefined,
): string[] | undefined {
  if (overrides === undefined) return base;
  // Settings files are not validated; a malformed value replaces instead of throwing here.
  if (!Array.isArray(base) || !Array.isArray(overrides) || !overrides.every(isToolModifier))
    return overrides;
  return [...base, ...overrides];
}

/**
 * Resolve a merged `defaultTools` list: plain names replace `DEFAULT_TOOL_NAMES`, then `+name` adds
 * and `-name` removes a tool, in list order.
 */
function resolveDefaultTools(entries: string[]): string[] {
  const plain = entries.filter((entry) => !isToolModifier(entry));
  return applyToolModifiers(
    plain.length > 0 || entries.length === 0 ? plain : DEFAULT_TOOL_NAMES,
    entries,
  );
}

/** Deep merge settings: project/overrides take precedence, nested objects merge recursively */
function deepMergeSettings(base: Settings, overrides: Settings): Settings {
  const merged = deepMergeObjects(
    base as Record<string, unknown>,
    overrides as Record<string, unknown>,
  ) as Settings;
  const defaultTools = mergeDefaultTools(base.defaultTools, overrides.defaultTools);
  return defaultTools === undefined ? merged : { ...merged, defaultTools };
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

export type SettingsScope = "global" | "project";

export interface SettingsManagerCreateOptions {
  projectTrusted?: boolean;
}

export interface SettingsStorage {
  withLock(scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void;
}

export interface SettingsError {
  scope: SettingsScope;
  path?: string;
  error: Error;
}

type SettingsPaths = Partial<Record<SettingsScope, string>>;

function toSettingsError(scope: SettingsScope, error: unknown, path?: string): SettingsError {
  return {
    scope,
    ...(path ? { path } : {}),
    error: error instanceof Error ? error : new Error(String(error)),
  };
}

export class FileSettingsStorage implements SettingsStorage {
  private globalSettingsPath: string;
  private projectSettingsPath: string;

  constructor(cwd: string, agentDir: string) {
    const resolvedCwd = resolvePath(cwd);
    const resolvedAgentDir = resolvePath(agentDir);
    this.globalSettingsPath = join(resolvedAgentDir, "settings.json");
    this.projectSettingsPath = join(resolvedCwd, CONFIG_DIR_NAME, "settings.json");
  }

  private acquireLockSyncWithRetry(path: string): () => void {
    const maxAttempts = 10;
    const delayMs = 20;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return lockfile.lockSync(path, { realpath: false });
      } catch (error) {
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? String((error as { code?: unknown }).code)
            : undefined;
        if (code !== "ELOCKED" || attempt === maxAttempts) {
          throw error;
        }
        lastError = error;
        const start = Date.now();
        while (Date.now() - start < delayMs) {
          // Sleep synchronously to avoid changing callers to async.
        }
      }
    }

    throw (lastError as Error) ?? new Error("Failed to acquire settings lock");
  }

  withLock(scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void {
    const path = scope === "global" ? this.globalSettingsPath : this.projectSettingsPath;
    const dir = dirname(path);

    let release: (() => void) | undefined;
    try {
      // Only create directory and lock if file exists or we need to write
      const fileExists = existsSync(path);
      if (fileExists) {
        release = this.acquireLockSyncWithRetry(path);
      }
      const current = fileExists ? readFileSync(path, "utf-8") : undefined;
      const next = fn(current);
      if (next !== undefined) {
        // Only create directory when we actually need to write
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        if (!release) {
          release = this.acquireLockSyncWithRetry(path);
        }
        writeFileSync(path, next, "utf-8");
      }
    } finally {
      if (release) {
        release();
      }
    }
  }
}

export class InMemorySettingsStorage implements SettingsStorage {
  private global: string | undefined;
  private project: string | undefined;

  withLock(scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void {
    const current = scope === "global" ? this.global : this.project;
    const next = fn(current);
    if (next !== undefined) {
      if (scope === "global") {
        this.global = next;
      } else {
        this.project = next;
      }
    }
  }
}

/** Settings whose value is an object of independently modifiable keys. */
type ObjectSettingKey = {
  [K in keyof Settings]-?: NonNullable<Settings[K]> extends readonly unknown[]
    ? never
    : NonNullable<Settings[K]> extends Record<string, unknown>
      ? K
      : never;
}[keyof Settings];

export class SettingsManager {
  private storage: SettingsStorage;
  private globalSettings: Settings;
  private projectSettings: Settings;
  private settings: Settings;
  private projectTrusted: boolean;
  private modifiedFields = new Set<keyof Settings>(); // Track global fields modified during session
  private modifiedNestedFields = new Map<keyof Settings, Set<string>>(); // Track global nested field modifications
  private modifiedProjectFields = new Set<keyof Settings>(); // Track project fields modified during session
  private modifiedProjectNestedFields = new Map<keyof Settings, Set<string>>(); // Track project nested field modifications
  private globalSettingsLoadError: Error | null = null; // Track if global settings file had parse errors
  private projectSettingsLoadError: Error | null = null; // Track if project settings file had parse errors
  private writeQueue: Promise<void> = Promise.resolve();
  private errors: SettingsError[];
  private settingsPaths: SettingsPaths;

  private constructor(
    storage: SettingsStorage,
    initialGlobal: Settings,
    initialProject: Settings,
    globalLoadError: Error | null = null,
    projectLoadError: Error | null = null,
    initialErrors: SettingsError[] = [],
    projectTrusted = true,
    settingsPaths: SettingsPaths = {},
  ) {
    this.storage = storage;
    this.globalSettings = initialGlobal;
    this.projectSettings = initialProject;
    this.projectTrusted = projectTrusted;
    this.globalSettingsLoadError = globalLoadError;
    this.projectSettingsLoadError = projectLoadError;
    this.errors = [...initialErrors];
    this.settingsPaths = settingsPaths;
    this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);
  }

  /** Create a SettingsManager that loads from files */
  static create(
    cwd: string,
    agentDir: string = getAgentDir(),
    options: SettingsManagerCreateOptions = {},
  ): SettingsManager {
    const resolvedCwd = resolvePath(cwd);
    const resolvedAgentDir = resolvePath(agentDir);
    const storage = new FileSettingsStorage(resolvedCwd, resolvedAgentDir);
    return SettingsManager.fromStorageWithPaths(storage, options, {
      global: join(resolvedAgentDir, "settings.json"),
      project: join(resolvedCwd, CONFIG_DIR_NAME, "settings.json"),
    });
  }

  /** Create a SettingsManager from an arbitrary storage backend */
  static fromStorage(
    storage: SettingsStorage,
    options: SettingsManagerCreateOptions = {},
  ): SettingsManager {
    return SettingsManager.fromStorageWithPaths(storage, options);
  }

  /** Create a manager while retaining optional file paths for reported storage errors. */
  private static fromStorageWithPaths(
    storage: SettingsStorage,
    options: SettingsManagerCreateOptions,
    settingsPaths: SettingsPaths = {},
  ): SettingsManager {
    const projectTrusted = options.projectTrusted ?? true;
    const globalLoad = SettingsManager.tryLoadFromStorage(storage, "global");
    const projectLoad = SettingsManager.tryLoadFromStorage(storage, "project", projectTrusted);
    const initialErrors: SettingsError[] = [];
    if (globalLoad.error) {
      initialErrors.push(toSettingsError("global", globalLoad.error, settingsPaths.global));
    }
    if (projectLoad.error) {
      initialErrors.push(toSettingsError("project", projectLoad.error, settingsPaths.project));
    }

    return new SettingsManager(
      storage,
      globalLoad.settings,
      projectLoad.settings,
      globalLoad.error,
      projectLoad.error,
      initialErrors,
      projectTrusted,
      settingsPaths,
    );
  }

  /** Create an in-memory SettingsManager (no file I/O) */
  static inMemory(
    settings: Partial<Settings> = {},
    options: SettingsManagerCreateOptions = {},
  ): SettingsManager {
    const storage = new InMemorySettingsStorage();
    const initialSettings = SettingsManager.migrateSettings(
      structuredClone(settings) as Record<string, unknown>,
    );
    storage.withLock("global", () => JSON.stringify(initialSettings, null, 2));
    return SettingsManager.fromStorage(storage, options);
  }

  private static loadFromStorage(
    storage: SettingsStorage,
    scope: SettingsScope,
    projectTrusted = true,
  ): Settings {
    if (scope === "project" && !projectTrusted) {
      return {};
    }

    let content: string | undefined;
    storage.withLock(scope, (current) => {
      content = current;
      return undefined;
    });

    if (!content) {
      return {};
    }
    const settings = JSON.parse(stripBom(content));
    return SettingsManager.migrateSettings(settings);
  }

  private static tryLoadFromStorage(
    storage: SettingsStorage,
    scope: SettingsScope,
    projectTrusted = true,
  ): { settings: Settings; error: Error | null } {
    try {
      return {
        settings: SettingsManager.loadFromStorage(storage, scope, projectTrusted),
        error: null,
      };
    } catch (error) {
      return { settings: {}, error: error as Error };
    }
  }

  /** Migrate old settings format to new format */
  private static migrateSettings(settings: Record<string, unknown>): Settings {
    // Migrate queueMode -> steeringMode
    if ("queueMode" in settings && !("steeringMode" in settings)) {
      settings.steeringMode = settings.queueMode;
      delete settings.queueMode;
    }

    // Migrate legacy websockets boolean -> transport enum
    if (!("transport" in settings) && typeof settings.websockets === "boolean") {
      settings.transport = settings.websockets ? "websocket" : "sse";
      delete settings.websockets;
    }

    // Migrate old skills object format to new array format
    if (
      "skills" in settings &&
      typeof settings.skills === "object" &&
      settings.skills !== null &&
      !Array.isArray(settings.skills)
    ) {
      const skillsSettings = settings.skills as {
        enableSkillCommands?: boolean;
        customDirectories?: unknown;
      };
      if (
        skillsSettings.enableSkillCommands !== undefined &&
        settings.enableSkillCommands === undefined
      ) {
        settings.enableSkillCommands = skillsSettings.enableSkillCommands;
      }
      if (
        Array.isArray(skillsSettings.customDirectories) &&
        skillsSettings.customDirectories.length > 0
      ) {
        settings.skills = skillsSettings.customDirectories;
      } else {
        delete settings.skills;
      }
    }

    // Migrate retry.maxDelayMs -> retry.provider.maxRetryDelayMs
    if (
      "retry" in settings &&
      typeof settings.retry === "object" &&
      settings.retry !== null &&
      !Array.isArray(settings.retry)
    ) {
      const retrySettings = settings.retry as Record<string, unknown>;
      const providerSettings =
        typeof retrySettings.provider === "object" && retrySettings.provider !== null
          ? (retrySettings.provider as Record<string, unknown>)
          : undefined;
      if (
        typeof retrySettings.maxDelayMs === "number" &&
        (providerSettings?.maxRetryDelayMs === undefined ||
          providerSettings?.maxRetryDelayMs === null)
      ) {
        retrySettings.provider = {
          ...(providerSettings ?? {}),
          maxRetryDelayMs: retrySettings.maxDelayMs,
        };
      }
      delete retrySettings.maxDelayMs;
    }

    return settings as Settings;
  }

  /** A copy of the effective settings: global and project settings merged, with overrides. */
  getSettings(): Settings {
    return structuredClone(this.settings);
  }

  getGlobalSettings(): Settings {
    return structuredClone(this.globalSettings);
  }

  getProjectSettings(): Settings {
    return structuredClone(this.projectSettings);
  }

  isProjectTrusted(): boolean {
    return this.projectTrusted;
  }

  setProjectTrusted(trusted: boolean): void {
    if (this.projectTrusted === trusted) {
      return;
    }

    this.projectTrusted = trusted;
    this.modifiedProjectFields.clear();
    this.modifiedProjectNestedFields.clear();

    if (!trusted) {
      this.projectSettings = {};
      this.projectSettingsLoadError = null;
      this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);
      return;
    }

    const projectLoad = SettingsManager.tryLoadFromStorage(this.storage, "project", trusted);
    this.projectSettings = projectLoad.settings;
    this.projectSettingsLoadError = projectLoad.error;
    if (projectLoad.error) {
      this.recordError("project", projectLoad.error);
    }
    this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);
  }

  async reload(): Promise<void> {
    await this.writeQueue;
    const globalLoad = SettingsManager.tryLoadFromStorage(this.storage, "global");
    if (!globalLoad.error) {
      this.globalSettings = globalLoad.settings;
      this.globalSettingsLoadError = null;
    } else {
      this.globalSettingsLoadError = globalLoad.error;
      this.recordError("global", globalLoad.error);
    }

    this.modifiedFields.clear();
    this.modifiedNestedFields.clear();
    this.modifiedProjectFields.clear();
    this.modifiedProjectNestedFields.clear();

    const projectLoad = SettingsManager.tryLoadFromStorage(
      this.storage,
      "project",
      this.projectTrusted,
    );
    if (!projectLoad.error) {
      this.projectSettings = projectLoad.settings;
      this.projectSettingsLoadError = null;
    } else {
      this.projectSettingsLoadError = projectLoad.error;
      this.recordError("project", projectLoad.error);
    }

    this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);
  }

  /** Apply additional overrides on top of current settings */
  applyOverrides(overrides: Partial<Settings>): void {
    this.settings = deepMergeSettings(this.settings, overrides);
  }

  /** Mark a global field as modified during this session */
  private markModified(field: keyof Settings, nestedKey?: string): void {
    this.modifiedFields.add(field);
    if (nestedKey) {
      if (!this.modifiedNestedFields.has(field)) {
        this.modifiedNestedFields.set(field, new Set());
      }
      this.modifiedNestedFields.get(field)!.add(nestedKey);
    }
  }

  /** Stores a top-level global setting and persists it. */
  private setGlobalSetting<K extends keyof Settings>(field: K, value: Settings[K]): void {
    this.globalSettings[field] = value;
    this.markModified(field);
    this.save();
  }

  /** Stores one key of an object-valued global setting and persists it. */
  private setNestedGlobalSetting<
    K extends ObjectSettingKey,
    N extends keyof NonNullable<Settings[K]> & string,
  >(field: K, key: N, value: NonNullable<Settings[K]>[N]): void {
    const group: NonNullable<Settings[K]> =
      this.globalSettings[field] ?? ({} as NonNullable<Settings[K]>);
    (group as Record<string, unknown>)[key] = value;
    this.globalSettings[field] = group;
    this.markModified(field, key);
    this.save();
  }

  /** Mark a project field as modified during this session */
  private markProjectModified(field: keyof Settings, nestedKey?: string): void {
    this.modifiedProjectFields.add(field);
    if (nestedKey) {
      if (!this.modifiedProjectNestedFields.has(field)) {
        this.modifiedProjectNestedFields.set(field, new Set());
      }
      this.modifiedProjectNestedFields.get(field)!.add(nestedKey);
    }
  }

  private assertProjectTrustedForWrite(): void {
    if (!this.projectTrusted) {
      throw new Error("Project is not trusted; refusing to write project settings");
    }
  }

  private recordError(scope: SettingsScope, error: unknown): void {
    this.errors.push(toSettingsError(scope, error, this.settingsPaths[scope]));
  }

  private clearModifiedScope(scope: SettingsScope): void {
    if (scope === "global") {
      this.modifiedFields.clear();
      this.modifiedNestedFields.clear();
      return;
    }

    this.modifiedProjectFields.clear();
    this.modifiedProjectNestedFields.clear();
  }

  private enqueueWrite(scope: SettingsScope, task: () => void): void {
    this.writeQueue = this.writeQueue
      .then(() => {
        if (scope === "project") {
          this.assertProjectTrustedForWrite();
        }
        task();
        this.clearModifiedScope(scope);
      })
      .catch((error) => {
        this.recordError(scope, error);
      });
  }

  private cloneModifiedNestedFields(
    source: Map<keyof Settings, Set<string>>,
  ): Map<keyof Settings, Set<string>> {
    const snapshot = new Map<keyof Settings, Set<string>>();
    for (const [key, value] of source.entries()) {
      snapshot.set(key, new Set(value));
    }
    return snapshot;
  }

  private persistScopedSettings(
    scope: SettingsScope,
    snapshotSettings: Settings,
    modifiedFields: Set<keyof Settings>,
    modifiedNestedFields: Map<keyof Settings, Set<string>>,
  ): void {
    this.storage.withLock(scope, (current) => {
      const currentFileSettings = current
        ? SettingsManager.migrateSettings(JSON.parse(stripBom(current)) as Record<string, unknown>)
        : {};
      const mergedSettings: Settings = { ...currentFileSettings };
      for (const field of modifiedFields) {
        const value = snapshotSettings[field];
        if (modifiedNestedFields.has(field) && typeof value === "object" && value !== null) {
          const nestedModified = modifiedNestedFields.get(field)!;
          const baseNested = (currentFileSettings[field] as Record<string, unknown>) ?? {};
          const inMemoryNested = value as Record<string, unknown>;
          const mergedNested = { ...baseNested };
          for (const nestedKey of nestedModified) {
            mergedNested[nestedKey] = inMemoryNested[nestedKey];
          }
          (mergedSettings as Record<string, unknown>)[field] = mergedNested;
        } else {
          (mergedSettings as Record<string, unknown>)[field] = value;
        }
      }

      return JSON.stringify(mergedSettings, null, 2);
    });
  }

  private save(): void {
    this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);

    if (this.globalSettingsLoadError) {
      return;
    }

    const snapshotGlobalSettings = structuredClone(this.globalSettings);
    const modifiedFields = new Set(this.modifiedFields);
    const modifiedNestedFields = this.cloneModifiedNestedFields(this.modifiedNestedFields);

    this.enqueueWrite("global", () => {
      this.persistScopedSettings(
        "global",
        snapshotGlobalSettings,
        modifiedFields,
        modifiedNestedFields,
      );
    });
  }

  private saveProjectSettings(settings: Settings): void {
    this.assertProjectTrustedForWrite();
    this.projectSettings = structuredClone(settings);
    this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);

    if (this.projectSettingsLoadError) {
      return;
    }

    const snapshotProjectSettings = structuredClone(this.projectSettings);
    const modifiedFields = new Set(this.modifiedProjectFields);
    const modifiedNestedFields = this.cloneModifiedNestedFields(this.modifiedProjectNestedFields);
    this.enqueueWrite("project", () => {
      this.persistScopedSettings(
        "project",
        snapshotProjectSettings,
        modifiedFields,
        modifiedNestedFields,
      );
    });
  }

  private updateProjectSettings(field: keyof Settings, update: (settings: Settings) => void): void {
    this.assertProjectTrustedForWrite();
    const projectSettings = structuredClone(this.projectSettings);
    update(projectSettings);
    this.markProjectModified(field);
    this.saveProjectSettings(projectSettings);
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  drainErrors(): SettingsError[] {
    const drained = [...this.errors];
    this.errors = [];
    return drained;
  }

  getLastChangelogVersion(): string | undefined {
    return this.settings.lastChangelogVersion;
  }

  setLastChangelogVersion(version: string): void {
    this.setGlobalSetting("lastChangelogVersion", version);
  }

  getSessionDir(): string | undefined {
    const sessionDir = this.settings.sessionDir;
    return sessionDir ? normalizePath(sessionDir) : sessionDir;
  }

  getDefaultProvider(): string | undefined {
    return this.settings.defaultProvider;
  }

  getDefaultModel(): string | undefined {
    return this.settings.defaultModel;
  }

  setDefaultProvider(provider: string): void {
    this.setGlobalSetting("defaultProvider", provider);
  }

  setDefaultModel(modelId: string): void {
    this.setGlobalSetting("defaultModel", modelId);
  }

  setDefaultModelAndProvider(provider: string, modelId: string): void {
    this.globalSettings.defaultProvider = provider;
    this.globalSettings.defaultModel = modelId;
    this.markModified("defaultProvider");
    this.markModified("defaultModel");
    this.save();
  }

  getSteeringMode(): "all" | "one-at-a-time" {
    return this.settings.steeringMode || SETTINGS_DEFAULTS.steeringMode;
  }

  setSteeringMode(mode: "all" | "one-at-a-time"): void {
    this.setGlobalSetting("steeringMode", mode);
  }

  getFollowUpMode(): "all" | "one-at-a-time" {
    return this.settings.followUpMode || SETTINGS_DEFAULTS.followUpMode;
  }

  setFollowUpMode(mode: "all" | "one-at-a-time"): void {
    this.setGlobalSetting("followUpMode", mode);
  }

  getThemeSetting(): string | undefined {
    const value = this.settings.theme;
    if (typeof value === "string") return value;
    return undefined;
  }

  getTheme(): string | undefined {
    const theme = this.getThemeSetting();
    return theme?.includes("/") ? undefined : theme;
  }

  setTheme(theme: string): void {
    this.setGlobalSetting("theme", theme);
  }

  getDefaultThinkingLevel(): ThinkingLevel | undefined {
    return this.settings.defaultThinkingLevel;
  }

  setDefaultThinkingLevel(level: ThinkingLevel): void {
    this.setGlobalSetting("defaultThinkingLevel", level);
  }

  getModelThinkingLevel(provider: string, modelId: string): ThinkingLevel | undefined {
    return this.settings.modelThinkingLevels?.[`${provider}/${modelId}`];
  }

  getAllModelThinkingLevels(): Record<string, ThinkingLevel> {
    return { ...(this.settings.modelThinkingLevels ?? {}) };
  }

  setModelThinkingLevel(provider: string, modelId: string, level: ThinkingLevel): void {
    if (!this.globalSettings.modelThinkingLevels) {
      this.globalSettings.modelThinkingLevels = {};
    }
    this.globalSettings.modelThinkingLevels[`${provider}/${modelId}`] = level;
    this.markModified("modelThinkingLevels");
    this.save();
  }

  removeModelThinkingLevel(provider: string, modelId: string): void {
    if (!this.globalSettings.modelThinkingLevels) return;
    delete this.globalSettings.modelThinkingLevels[`${provider}/${modelId}`];
    if (Object.keys(this.globalSettings.modelThinkingLevels).length === 0) {
      delete this.globalSettings.modelThinkingLevels;
    }
    this.markModified("modelThinkingLevels");
    this.save();
  }

  getTransport(): TransportSetting {
    return this.settings.transport ?? SETTINGS_DEFAULTS.transport;
  }

  setTransport(transport: TransportSetting): void {
    this.setGlobalSetting("transport", transport);
  }

  getSessionShareDestination(): SessionShareDestination {
    const destination = this.settings.sessionShareDestination;
    return destination === "gist" || destination === "radius"
      ? destination
      : SETTINGS_DEFAULTS.sessionShareDestination;
  }

  setSessionShareDestination(destination: SessionShareDestination): void {
    this.setGlobalSetting("sessionShareDestination", destination);
  }

  getCompactionEnabled(): boolean {
    return this.settings.compaction?.enabled ?? SETTINGS_DEFAULTS.compaction.enabled;
  }

  setCompactionEnabled(enabled: boolean): void {
    this.setNestedGlobalSetting("compaction", "enabled", enabled);
  }

  private getCompactionTokenSetting(
    field: keyof CompactionModelOverride,
    model?: Pick<Model<string>, "provider" | "id">,
  ): number {
    const compaction = this.settings.compaction;
    const ordinary = compaction?.[field];
    if (
      ordinary !== undefined &&
      (typeof ordinary !== "number" || !Number.isSafeInteger(ordinary) || ordinary < 0)
    ) {
      throw new Error(
        `Invalid compaction.${field} setting: ${String(ordinary)}. Expected a non-negative safe integer.`,
      );
    }

    const modelKey = model ? `${model.provider}/${model.id}` : undefined;
    const entry = modelKey !== undefined ? compaction?.modelOverrides?.[modelKey] : undefined;
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

  getCompactionReserveTokens(model?: Pick<Model<string>, "provider" | "id">): number {
    return this.getCompactionTokenSetting("reserveTokens", model);
  }

  getCompactionKeepRecentTokens(model?: Pick<Model<string>, "provider" | "id">): number {
    return this.getCompactionTokenSetting("keepRecentTokens", model);
  }

  /** Resolve each token setting through model override, ordinary setting, then built-in default. */
  getCompactionSettings(model?: Pick<Model<string>, "provider" | "id">): {
    enabled: boolean;
    reserveTokens: number;
    keepRecentTokens: number;
  } {
    return {
      enabled: this.getCompactionEnabled(),
      reserveTokens: this.getCompactionReserveTokens(model),
      keepRecentTokens: this.getCompactionKeepRecentTokens(model),
    };
  }

  getBranchSummarySettings(): { reserveTokens: number; skipPrompt: boolean } {
    return {
      reserveTokens:
        this.settings.branchSummary?.reserveTokens ?? SETTINGS_DEFAULTS.branchSummary.reserveTokens,
      skipPrompt:
        this.settings.branchSummary?.skipPrompt ?? SETTINGS_DEFAULTS.branchSummary.skipPrompt,
    };
  }

  getBranchSummarySkipPrompt(): boolean {
    return this.settings.branchSummary?.skipPrompt ?? SETTINGS_DEFAULTS.branchSummary.skipPrompt;
  }

  getGoalEvaluatorModel(): string | undefined {
    return this.settings.goal?.evaluatorModel;
  }

  getOrchestratorWorkerModel(): string | undefined {
    return this.settings.orchestrator?.workerModel;
  }

  getOrchestratorWorkerThinkingLevel(): ThinkingLevel | undefined {
    return this.settings.orchestrator?.workerThinkingLevel;
  }

  getOrchestratorReviewModel(): string | undefined {
    return this.settings.orchestrator?.reviewModel;
  }

  getOrchestratorReviewThinkingLevel(): ThinkingLevel | undefined {
    return this.settings.orchestrator?.reviewThinkingLevel;
  }

  getOrchestratorMaxConcurrentSessions(): number {
    return (
      this.settings.orchestrator?.maxConcurrentSessions ??
      SETTINGS_DEFAULTS.orchestrator.maxConcurrentSessions
    );
  }

  getRetryEnabled(): boolean {
    return this.settings.retry?.enabled ?? SETTINGS_DEFAULTS.retry.enabled;
  }

  setRetryEnabled(enabled: boolean): void {
    this.setNestedGlobalSetting("retry", "enabled", enabled);
  }

  getRetrySettings(): {
    enabled: boolean;
    maxRetries: number;
    baseDelayMs: number;
    maxAgentDelayMs: number;
  } {
    return {
      enabled: this.getRetryEnabled(),
      maxRetries: this.settings.retry?.maxRetries ?? SETTINGS_DEFAULTS.retry.maxRetries,
      baseDelayMs: this.settings.retry?.baseDelayMs ?? SETTINGS_DEFAULTS.retry.baseDelayMs,
      maxAgentDelayMs:
        this.settings.retry?.maxAgentDelayMs ?? SETTINGS_DEFAULTS.retry.maxAgentDelayMs,
    };
  }

  getHttpIdleTimeoutMs(): number {
    return (
      parseTimeoutSetting(this.settings.httpIdleTimeoutMs, "httpIdleTimeoutMs") ??
      DEFAULT_HTTP_IDLE_TIMEOUT_MS
    );
  }

  setHttpIdleTimeoutMs(timeoutMs: number): void {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new Error(`Invalid httpIdleTimeoutMs setting: ${String(timeoutMs)}`);
    }
    this.setGlobalSetting("httpIdleTimeoutMs", Math.floor(timeoutMs));
  }

  /** Read from global settings only because warming costs money. */
  getCacheWarmingMode(): CacheWarmingMode {
    const mode = this.globalSettings.cacheWarming;
    return mode !== undefined && CACHE_WARMING_MODES.includes(mode)
      ? mode
      : SETTINGS_DEFAULTS.cacheWarming;
  }

  setCacheWarmingMode(mode: CacheWarmingMode): void {
    this.setGlobalSetting("cacheWarming", mode);
  }

  getProviderRetrySettings(): { timeoutMs?: number; maxRetries?: number; maxRetryDelayMs: number } {
    return {
      timeoutMs: this.settings.retry?.provider?.timeoutMs,
      maxRetries: this.settings.retry?.provider?.maxRetries,
      maxRetryDelayMs:
        this.settings.retry?.provider?.maxRetryDelayMs ??
        SETTINGS_DEFAULTS.retry.provider.maxRetryDelayMs,
    };
  }

  getWebSocketConnectTimeoutMs(): number | undefined {
    return parseTimeoutSetting(
      this.settings.websocketConnectTimeoutMs,
      "websocketConnectTimeoutMs",
    );
  }

  getHideThinkingBlock(): boolean {
    return this.settings.hideThinkingBlock ?? SETTINGS_DEFAULTS.hideThinkingBlock;
  }

  getShowCacheMissNotices(): boolean {
    return this.settings.showCacheMissNotices ?? SETTINGS_DEFAULTS.showCacheMissNotices;
  }

  getExternalEditorCommand(): string {
    const configuredEditor = this.settings.externalEditor;
    if (typeof configuredEditor === "string" && configuredEditor.trim() !== "") {
      return configuredEditor;
    }
    const environmentEditor = process.env.VISUAL || process.env.EDITOR;
    if (environmentEditor) {
      return environmentEditor;
    }
    return process.platform === "win32" ? "notepad" : "nano";
  }

  setHideThinkingBlock(hide: boolean): void {
    this.setGlobalSetting("hideThinkingBlock", hide);
  }

  setShowCacheMissNotices(show: boolean): void {
    this.setGlobalSetting("showCacheMissNotices", show);
  }

  getShellPath(): string | undefined {
    const shellPath = this.settings.shellPath;
    return shellPath ? normalizePath(shellPath) : shellPath;
  }

  setShellPath(path: string | undefined): void {
    this.setGlobalSetting("shellPath", path);
  }

  getQuietStartup(): QuietStartup {
    const value = this.settings.quietStartup;
    return value === true || value === "header" ? value : SETTINGS_DEFAULTS.quietStartup;
  }

  setQuietStartup(quiet: QuietStartup): void {
    this.setGlobalSetting("quietStartup", quiet);
  }

  getDefaultProjectTrust(): DefaultProjectTrust {
    const value = this.globalSettings.defaultProjectTrust;
    return value === "always" || value === "never" ? value : SETTINGS_DEFAULTS.defaultProjectTrust;
  }

  setDefaultProjectTrust(defaultProjectTrust: DefaultProjectTrust): void {
    this.setGlobalSetting("defaultProjectTrust", defaultProjectTrust);
  }

  getShellCommandPrefix(): string | undefined {
    return this.settings.shellCommandPrefix;
  }

  setShellCommandPrefix(prefix: string | undefined): void {
    this.setGlobalSetting("shellCommandPrefix", prefix);
  }

  getNpmCommand(): string[] | undefined {
    return this.settings.npmCommand ? [...this.settings.npmCommand] : undefined;
  }

  setNpmCommand(command: string[] | undefined): void {
    this.setGlobalSetting("npmCommand", command ? [...command] : undefined);
  }

  getCollapseChangelog(): boolean {
    return this.settings.collapseChangelog ?? SETTINGS_DEFAULTS.collapseChangelog;
  }

  setCollapseChangelog(collapse: boolean): void {
    this.setGlobalSetting("collapseChangelog", collapse);
  }

  getEnableInstallTelemetry(): boolean {
    return this.settings.enableInstallTelemetry ?? SETTINGS_DEFAULTS.enableInstallTelemetry;
  }

  setEnableInstallTelemetry(enabled: boolean): void {
    this.setGlobalSetting("enableInstallTelemetry", enabled);
  }

  getEnableAnalytics(): boolean {
    return this.settings.enableAnalytics ?? SETTINGS_DEFAULTS.enableAnalytics;
  }

  getTrackingId(): string | undefined {
    return this.settings.trackingId;
  }

  /** Set the analytics opt-in preference; generates a tracking identifier on first opt-in */
  setEnableAnalytics(enabled: boolean): void {
    this.globalSettings.enableAnalytics = enabled;
    this.markModified("enableAnalytics");
    if (enabled && !this.globalSettings.trackingId) {
      this.globalSettings.trackingId = randomUUID();
      this.markModified("trackingId");
    }
    this.save();
  }

  /**
   * Stable ID of this installation, e.g. sent to OpenAI as its agent host ID.
   * Created on first use. Project settings are ignored so a committed project
   * settings file cannot give every clone the same ID.
   */
  getOrCreateDeviceId(): string {
    if (!this.globalSettings.deviceId) {
      this.globalSettings.deviceId = randomUUID();
      this.markModified("deviceId");
      this.save();
    }
    return this.globalSettings.deviceId;
  }

  getPackages(): PackageSource[] {
    return [...(this.settings.packages ?? [])];
  }

  setPackages(packages: PackageSource[]): void {
    this.setGlobalSetting("packages", packages);
  }

  setProjectPackages(packages: PackageSource[]): void {
    this.updateProjectSettings("packages", (settings) => {
      settings.packages = packages;
    });
  }

  getExtensionPaths(): string[] {
    return [...(this.settings.extensions ?? [])];
  }

  setExtensionPaths(paths: string[]): void {
    this.setGlobalSetting("extensions", paths);
  }

  setProjectExtensionPaths(paths: string[]): void {
    this.updateProjectSettings("extensions", (settings) => {
      settings.extensions = paths;
    });
  }

  getSkillPaths(): string[] {
    return [...(this.settings.skills ?? [])];
  }

  setSkillPaths(paths: string[]): void {
    this.setGlobalSetting("skills", paths);
  }

  setProjectSkillPaths(paths: string[]): void {
    this.updateProjectSettings("skills", (settings) => {
      settings.skills = paths;
    });
  }

  getPromptTemplatePaths(): string[] {
    return [...(this.settings.prompts ?? [])];
  }

  setPromptTemplatePaths(paths: string[]): void {
    this.setGlobalSetting("prompts", paths);
  }

  setProjectPromptTemplatePaths(paths: string[]): void {
    this.updateProjectSettings("prompts", (settings) => {
      settings.prompts = paths;
    });
  }

  getThemePaths(): string[] {
    return [...(this.settings.themes ?? [])];
  }

  setThemePaths(paths: string[]): void {
    this.setGlobalSetting("themes", paths);
  }

  setProjectThemePaths(paths: string[]): void {
    this.updateProjectSettings("themes", (settings) => {
      settings.themes = paths;
    });
  }

  getEnableSkillCommands(): boolean {
    return this.settings.enableSkillCommands ?? SETTINGS_DEFAULTS.enableSkillCommands;
  }

  setEnableSkillCommands(enabled: boolean): void {
    this.setGlobalSetting("enableSkillCommands", enabled);
  }

  getThinkingBudgets(): ThinkingBudgetsSettings | undefined {
    return this.settings.thinkingBudgets;
  }

  getTerminalCapabilityOverrides(): Partial<TerminalCapabilities> {
    const terminal = this.settings.terminal;
    const images = terminal?.images;
    return {
      ...(images === "kitty" || images === "iterm2"
        ? { images }
        : images === false
          ? { images: null }
          : {}),
      ...(typeof terminal?.trueColor === "boolean" ? { trueColor: terminal.trueColor } : {}),
      ...(typeof terminal?.hyperlinks === "boolean" ? { hyperlinks: terminal.hyperlinks } : {}),
    };
  }

  getShowImages(): boolean {
    return this.settings.terminal?.showImages ?? SETTINGS_DEFAULTS.terminal.showImages;
  }

  setShowImages(show: boolean): void {
    this.setNestedGlobalSetting("terminal", "showImages", show);
  }

  getImageWidthCells(): number {
    const width = this.settings.terminal?.imageWidthCells;
    if (typeof width !== "number" || !Number.isFinite(width)) {
      return SETTINGS_DEFAULTS.terminal.imageWidthCells;
    }
    return Math.max(1, Math.floor(width));
  }

  setImageWidthCells(width: number): void {
    this.setNestedGlobalSetting("terminal", "imageWidthCells", Math.max(1, Math.floor(width)));
  }

  getClearOnShrink(): boolean {
    // Settings takes precedence, then env var, then default false
    if (this.settings.terminal?.clearOnShrink !== undefined) {
      return this.settings.terminal.clearOnShrink;
    }
    if (process.env.MSA_CLEAR_ON_SHRINK === "1") return true;
    return SETTINGS_DEFAULTS.terminal.clearOnShrink;
  }

  setClearOnShrink(enabled: boolean): void {
    this.setNestedGlobalSetting("terminal", "clearOnShrink", enabled);
  }

  getShowTerminalProgress(): boolean {
    return (
      this.settings.terminal?.showTerminalProgress ??
      SETTINGS_DEFAULTS.terminal.showTerminalProgress
    );
  }

  setShowTerminalProgress(enabled: boolean): void {
    this.setNestedGlobalSetting("terminal", "showTerminalProgress", enabled);
  }

  getTuiMode(): TuiMode {
    return this.settings.tuiMode === "regular" ? "regular" : SETTINGS_DEFAULTS.tuiMode;
  }

  setTuiMode(mode: TuiMode): void {
    this.setGlobalSetting("tuiMode", mode);
  }

  getFullscreenExitOutput(): FullscreenExitOutput {
    return this.settings.fullscreenExitOutput === "resume-hint"
      ? "resume-hint"
      : SETTINGS_DEFAULTS.fullscreenExitOutput;
  }

  setFullscreenExitOutput(output: FullscreenExitOutput): void {
    this.setGlobalSetting("fullscreenExitOutput", output);
  }

  getFullscreenScrollbar(): ScrollViewScrollbar {
    const mode = this.settings.fullscreenScrollbar;
    return mode === "always" || mode === "hidden" ? mode : SETTINGS_DEFAULTS.fullscreenScrollbar;
  }

  setFullscreenScrollbar(mode: ScrollViewScrollbar): void {
    this.setGlobalSetting("fullscreenScrollbar", mode);
  }

  getFullscreenCopyOnSelect(): boolean {
    return this.settings.fullscreenCopyOnSelect ?? SETTINGS_DEFAULTS.fullscreenCopyOnSelect;
  }

  setFullscreenCopyOnSelect(enabled: boolean): void {
    this.setGlobalSetting("fullscreenCopyOnSelect", enabled);
  }

  getFullscreenWheelScrollLines(): WheelScrollLines {
    const lines = this.settings.fullscreenWheelScrollLines;
    return typeof lines === "number" && Number.isFinite(lines)
      ? Math.max(1, Math.min(100, Math.floor(lines)))
      : SETTINGS_DEFAULTS.fullscreenWheelScrollLines;
  }

  setFullscreenWheelScrollLines(lines: WheelScrollLines): void {
    this.globalSettings.fullscreenWheelScrollLines =
      lines === "auto" ? lines : Math.max(1, Math.min(100, Math.floor(lines)));
    this.markModified("fullscreenWheelScrollLines");
    this.save();
  }

  getImageAutoResize(): boolean {
    return this.settings.images?.autoResize ?? SETTINGS_DEFAULTS.images.autoResize;
  }

  setImageAutoResize(enabled: boolean): void {
    this.setNestedGlobalSetting("images", "autoResize", enabled);
  }

  getBlockImages(): boolean {
    return this.settings.images?.blockImages ?? SETTINGS_DEFAULTS.images.blockImages;
  }

  setBlockImages(blocked: boolean): void {
    this.setNestedGlobalSetting("images", "blockImages", blocked);
  }

  /** Memory settings with defaults applied and the database path resolved. */
  getMemorySettings(): ResolvedMemorySettings {
    const memory = this.settings.memory;
    const defaults = SETTINGS_DEFAULTS.memory;
    const apiKeyEnv = memory?.embedding?.apiKeyEnv?.trim();
    const apiKey = apiKeyEnv ? process.env[apiKeyEnv]?.trim() : undefined;
    const database = memory?.database?.trim();
    const timeoutMs = memory?.embedding?.timeoutMs;
    const limit = memory?.recall?.limit;
    const minScore = memory?.recall?.minScore;
    const agentDir = this.settingsPaths.global ? dirname(this.settingsPaths.global) : getAgentDir();
    return {
      enabled: memory?.enabled ?? defaults.enabled,
      database: database ? resolvePath(database, agentDir) : join(agentDir, "memory.db"),
      embedding: {
        enabled: memory?.embedding?.enabled ?? defaults.embedding.enabled,
        baseUrl: memory?.embedding?.baseUrl?.trim() || defaults.embedding.baseUrl,
        model: memory?.embedding?.model?.trim() || defaults.embedding.model,
        queryPrefix: memory?.embedding?.queryPrefix ?? defaults.embedding.queryPrefix,
        documentPrefix: memory?.embedding?.documentPrefix ?? defaults.embedding.documentPrefix,
        ...(apiKey ? { apiKey } : {}),
        timeoutMs:
          typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs >= 0
            ? timeoutMs
            : defaults.embedding.timeoutMs,
      },
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

  getEnabledModels(): string[] | undefined {
    return this.settings.enabledModels;
  }

  /** The resolved `defaultTools` selection, or undefined when no settings layer sets it. */
  getDefaultTools(): string[] | undefined {
    const tools = this.settings.defaultTools;
    if (tools === undefined) return undefined;
    return resolveDefaultTools(
      Array.isArray(tools) ? tools.filter((tool) => typeof tool === "string") : [],
    );
  }

  setEnabledModels(patterns: string[] | undefined): void {
    this.setGlobalSetting("enabledModels", patterns);
  }

  getDoubleEscapeAction(): "fork" | "tree" | "none" {
    return this.settings.doubleEscapeAction ?? SETTINGS_DEFAULTS.doubleEscapeAction;
  }

  setDoubleEscapeAction(action: "fork" | "tree" | "none"): void {
    this.setGlobalSetting("doubleEscapeAction", action);
  }

  getTreeFilterMode(): "default" | "no-tools" | "user-only" | "labeled-only" | "all" {
    const mode = this.settings.treeFilterMode;
    const valid = ["default", "no-tools", "user-only", "labeled-only", "all"];
    return mode && valid.includes(mode) ? mode : SETTINGS_DEFAULTS.treeFilterMode;
  }

  setTreeFilterMode(mode: "default" | "no-tools" | "user-only" | "labeled-only" | "all"): void {
    this.setGlobalSetting("treeFilterMode", mode);
  }

  getShowHardwareCursor(): boolean {
    return this.settings.showHardwareCursor ?? process.env.MSA_HARDWARE_CURSOR === "1";
  }

  setShowHardwareCursor(enabled: boolean): void {
    this.setGlobalSetting("showHardwareCursor", enabled);
  }

  getEditorPaddingX(): number {
    return this.settings.editorPaddingX ?? SETTINGS_DEFAULTS.editorPaddingX;
  }

  setEditorPaddingX(padding: number): void {
    this.setGlobalSetting("editorPaddingX", Math.max(0, Math.min(3, Math.floor(padding))));
  }

  getOutputPad(): 0 | 1 {
    return this.settings.outputPad === 0 ? 0 : SETTINGS_DEFAULTS.outputPad;
  }

  setOutputPad(padding: 0 | 1): void {
    this.setGlobalSetting("outputPad", padding);
  }

  getAutocompleteMaxVisible(): number {
    return this.settings.autocompleteMaxVisible ?? SETTINGS_DEFAULTS.autocompleteMaxVisible;
  }

  setAutocompleteMaxVisible(maxVisible: number): void {
    this.setGlobalSetting(
      "autocompleteMaxVisible",
      Math.max(3, Math.min(20, Math.floor(maxVisible))),
    );
  }

  getCodeBlockIndent(): string {
    return this.settings.markdown?.codeBlockIndent ?? SETTINGS_DEFAULTS.markdown.codeBlockIndent;
  }

  getMermaidRenderingMode(): MermaidRenderingMode {
    const mode = this.settings.markdown?.mermaid;
    return mode === "off" || mode === "final" ? mode : SETTINGS_DEFAULTS.markdown.mermaid;
  }

  setMermaidRenderingMode(mode: MermaidRenderingMode): void {
    this.setNestedGlobalSetting("markdown", "mermaid", mode);
  }

  getWarnings(): WarningSettings {
    return { ...(this.settings.warnings ?? {}) };
  }

  setWarnings(warnings: WarningSettings): void {
    this.setGlobalSetting("warnings", { ...warnings });
  }
}
