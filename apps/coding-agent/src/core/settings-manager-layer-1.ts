import settingsDefaults from "./settings-defaults.ts";
import settingsManagerHelpers from "./settings-manager-helpers.ts";
import SettingsManagerLayer0 from "./settings-manager-layer-0.ts";
import SettingsManager from "./settings-manager.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";
import type settingsSchemaTypes from "./settings-schema.types.ts";

const { SETTINGS_DEFAULTS } = settingsDefaults;
const { deepMergeSettings, parseTimeoutSetting, resolveDefaultTools, toSettingsError } =
  settingsManagerHelpers;

export default abstract class SettingsManagerLayer1 extends SettingsManagerLayer0 {
  static fromStorage(
    storage: settingsManagerTypes.SettingsStorage,
    options: settingsManagerTypes.SettingsManagerCreateOptions = {},
  ): SettingsManager {
    return SettingsManager.fromStorageWithPaths(storage, options);
  }

  static migrateSettings(settings: Record<string, unknown>): settingsSchemaTypes.Settings {
    if ("queueMode" in settings && !("steeringMode" in settings)) {
      settings["steeringMode"] = settings["queueMode"];
      delete settings["queueMode"];
    }

    if (!("transport" in settings) && typeof settings["websockets"] === "boolean") {
      settings["transport"] = settings["websockets"] ? "websocket" : "sse";
      delete settings["websockets"];
    }

    if (
      "skills" in settings &&
      typeof settings["skills"] === "object" &&
      settings["skills"] !== null &&
      !Array.isArray(settings["skills"])
    ) {
      SettingsManager.migrateSettingsPart1(settings);
    }

    if (
      "retry" in settings &&
      typeof settings["retry"] === "object" &&
      settings["retry"] !== null &&
      !Array.isArray(settings["retry"])
    ) {
      const retrySettings = settings["retry"] as Record<string, unknown>;
      const providerSettings =
        typeof retrySettings["provider"] === "object" && retrySettings["provider"] !== null
          ? (retrySettings["provider"] as Record<string, unknown>)
          : undefined;
      if (
        typeof retrySettings["maxDelayMs"] === "number" &&
        (providerSettings?.["maxRetryDelayMs"] === undefined ||
          providerSettings?.["maxRetryDelayMs"] === null)
      ) {
        retrySettings["provider"] = {
          ...(providerSettings ?? {}),
          maxRetryDelayMs: retrySettings["maxDelayMs"],
        };
      }
      delete retrySettings["maxDelayMs"];
    }

    return settings as settingsSchemaTypes.Settings;
  }

  static migrateSettingsPart1(settings: Record<string, unknown>) {
    const skillsSettings = settings["skills"] as {
      enableSkillCommands?: boolean;
      customDirectories?: unknown;
    };
    if (
      skillsSettings.enableSkillCommands !== undefined &&
      settings["enableSkillCommands"] === undefined
    ) {
      settings["enableSkillCommands"] = skillsSettings.enableSkillCommands;
    }
    if (
      Array.isArray(skillsSettings.customDirectories) &&
      skillsSettings.customDirectories.length > 0
    ) {
      settings["skills"] = skillsSettings.customDirectories;
    } else {
      delete settings["skills"];
    }
  }

  getSettings(): settingsSchemaTypes.Settings {
    return structuredClone(this.settings);
  }

  getGlobalSettings(): settingsSchemaTypes.Settings {
    return structuredClone(this.globalSettings);
  }

  getProjectSettings(): settingsSchemaTypes.Settings {
    return structuredClone(this.projectSettings);
  }

  isProjectTrusted(): boolean {
    return this.projectTrusted;
  }

  applyOverrides(overrides: Partial<settingsSchemaTypes.Settings>): void {
    this.settings = deepMergeSettings(this.settings, overrides);
  }

  protected markModified(field: keyof settingsSchemaTypes.Settings, nestedKey?: string): void {
    this.modifiedFields.add(field);
    if (nestedKey !== undefined && nestedKey !== "") {
      if (!this.modifiedNestedFields.has(field)) {
        this.modifiedNestedFields.set(field, new Set());
      }
      this.modifiedNestedFields.get(field)!.add(nestedKey);
    }
  }

  protected markProjectModified(
    field: keyof settingsSchemaTypes.Settings,
    nestedKey?: string,
  ): void {
    this.modifiedProjectFields.add(field);
    if (nestedKey !== undefined && nestedKey !== "") {
      if (!this.modifiedProjectNestedFields.has(field)) {
        this.modifiedProjectNestedFields.set(field, new Set());
      }
      this.modifiedProjectNestedFields.get(field)!.add(nestedKey);
    }
  }

  protected assertProjectTrustedForWrite(): void {
    if (!this.projectTrusted) {
      throw new Error("Project is not trusted; refusing to write project settings");
    }
  }

  protected recordError(scope: settingsManagerTypes.SettingsScope, error: unknown): void {
    this.errors.push(toSettingsError(scope, error, this.settingsPaths[scope]));
  }

  protected clearModifiedScope(scope: settingsManagerTypes.SettingsScope): void {
    if (scope === "global") {
      this.modifiedFields.clear();
      this.modifiedNestedFields.clear();
      return;
    }

    this.modifiedProjectFields.clear();
    this.modifiedProjectNestedFields.clear();
  }

  protected cloneModifiedNestedFields(
    source: Map<keyof settingsSchemaTypes.Settings, Set<string>>,
  ): Map<keyof settingsSchemaTypes.Settings, Set<string>> {
    const snapshot = new Map<keyof settingsSchemaTypes.Settings, Set<string>>();
    for (const [key, value] of source.entries()) {
      snapshot.set(key, new Set(value));
    }
    return snapshot;
  }

  drainErrors(): settingsManagerTypes.SettingsError[] {
    const drained = [...this.errors];
    this.errors = [];
    return drained;
  }

  getLastChangelogVersion(): string | undefined {
    return this.settings.lastChangelogVersion;
  }

  getDefaultProvider(): string | undefined {
    return this.settings.defaultProvider;
  }

  getDefaultModel(): string | undefined {
    return this.settings.defaultModel;
  }

  getSteeringMode(): "all" | "one-at-a-time" {
    return this.settings.steeringMode || SETTINGS_DEFAULTS.steeringMode;
  }

  getFollowUpMode(): "all" | "one-at-a-time" {
    return this.settings.followUpMode || SETTINGS_DEFAULTS.followUpMode;
  }

  getThemeSetting(): string | undefined {
    const value = this.settings.theme;
    if (typeof value === "string") return value;
    return undefined;
  }

  getTheme(): string | undefined {
    const theme = this.getThemeSetting();
    return theme?.includes("/") === true ? undefined : theme;
  }

  getGoalEvaluatorModel(): string | undefined {
    return this.settings.goal?.evaluatorModel;
  }

  getOrchestratorWorkerModel(): string | undefined {
    return this.settings.orchestrator?.workerModel;
  }

  getOrchestratorReviewModel(): string | undefined {
    return this.settings.orchestrator?.reviewModel;
  }

  getWebSocketConnectTimeoutMs(): number | undefined {
    return parseTimeoutSetting(
      this.settings.websocketConnectTimeoutMs,
      "websocketConnectTimeoutMs",
    );
  }

  getClipboardImageCommand(): string | undefined {
    const command = this.globalSettings.clipboardImageCommand;
    return typeof command === "string" && command.trim() !== "" ? command : undefined;
  }

  getShellCommandPrefix(): string | undefined {
    return this.settings.shellCommandPrefix;
  }

  getNpmCommand(): string[] | undefined {
    return this.settings.npmCommand === undefined ? undefined : [...this.settings.npmCommand];
  }

  getTrackingId(): string | undefined {
    return this.settings.trackingId;
  }

  getPackages(): settingsSchemaTypes.PackageSource[] {
    return [...(this.settings.packages ?? [])];
  }

  getExtensionPaths(): string[] {
    return [...(this.settings.extensions ?? [])];
  }

  getSkillPaths(): string[] {
    return [...(this.settings.skills ?? [])];
  }

  getPromptTemplatePaths(): string[] {
    return [...(this.settings.prompts ?? [])];
  }

  getThemePaths(): string[] {
    return [...(this.settings.themes ?? [])];
  }

  getThinkingBudgets(): settingsSchemaTypes.ThinkingBudgetsSettings | undefined {
    return this.settings.thinkingBudgets;
  }

  getOtlpEndpoint(): string | undefined {
    const endpoint = this.settings.telemetry?.otlpEndpoint?.trim();
    return endpoint !== undefined && endpoint !== "" ? endpoint : undefined;
  }

  getEnabledModels(): string[] | undefined {
    return this.settings.enabledModels;
  }

  getDefaultTools(): string[] | undefined {
    const tools = this.settings.defaultTools;
    if (tools === undefined) return undefined;
    return resolveDefaultTools(
      Array.isArray(tools) ? tools.filter((tool) => typeof tool === "string") : [],
    );
  }
}
