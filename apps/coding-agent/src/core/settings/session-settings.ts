import config from "../../config.ts";
import pathsModule from "../../utils/paths.ts";
import httpDispatcher from "../http-dispatcher.ts";
import platform from "../platform/index.ts";
import settingsDefaults from "../settings-defaults.ts";
import settingsManagerHelpers from "../settings-manager-helpers.ts";
import settingsManagerSupport from "../settings-manager-support.ts";
import type SettingsManager from "../settings-manager.ts";
import type settingsSchemaTypes from "../settings-schema.types.ts";

const { parseTimeoutSetting } = settingsManagerHelpers;
const { SETTINGS_DEFAULTS } = settingsDefaults;
const { normalizePath, resolvePath } = pathsModule;
const { CACHE_WARMING_MODES } = settingsManagerSupport;
const { dirname, join } = platform;
const { getAgentDir } = config;
const { DEFAULT_HTTP_IDLE_TIMEOUT_MS } = httpDispatcher;

export default class SessionSettings {
  private readonly manager: SettingsManager;

  constructor(manager: SettingsManager) {
    this.manager = manager;
  }

  getSteeringMode(): "all" | "one-at-a-time" {
    return this.manager.settings.steeringMode || SETTINGS_DEFAULTS.steeringMode;
  }

  getFollowUpMode(): "all" | "one-at-a-time" {
    return this.manager.settings.followUpMode || SETTINGS_DEFAULTS.followUpMode;
  }

  getWebSocketConnectTimeoutMs(): number | undefined {
    return parseTimeoutSetting(
      this.manager.settings.websocketConnectTimeoutMs,
      "websocketConnectTimeoutMs",
    );
  }

  getSessionDir(): string | undefined {
    const sessionDir = this.manager.settings.sessionDir;
    return sessionDir !== undefined && sessionDir !== "" ? normalizePath(sessionDir) : sessionDir;
  }

  getOrchestratorMaxConcurrentThreads(): number {
    return (
      this.manager.settings.orchestrator?.maxConcurrentThreads ??
      SETTINGS_DEFAULTS.orchestrator.maxConcurrentThreads
    );
  }

  getRetryEnabled(): boolean {
    return this.manager.settings.retry?.enabled ?? SETTINGS_DEFAULTS.retry.enabled;
  }

  getRetrySettings(): {
    enabled: boolean;
    maxRetries: number;
    baseDelayMs: number;
    maxAgentDelayMs: number;
  } {
    return {
      baseDelayMs: this.manager.settings.retry?.baseDelayMs ?? SETTINGS_DEFAULTS.retry.baseDelayMs,
      enabled: this.getRetryEnabled(),
      maxAgentDelayMs:
        this.manager.settings.retry?.maxAgentDelayMs ?? SETTINGS_DEFAULTS.retry.maxAgentDelayMs,
      maxRetries: this.manager.settings.retry?.maxRetries ?? SETTINGS_DEFAULTS.retry.maxRetries,
    };
  }

  getCacheWarmingMode(): settingsSchemaTypes.CacheWarmingMode {
    const mode = this.manager.globalSettings.cacheWarming;
    return mode !== undefined && CACHE_WARMING_MODES.includes(mode)
      ? mode
      : SETTINGS_DEFAULTS.cacheWarming;
  }

  getProviderRetrySettings(): {
    timeoutMs?: number | undefined;
    maxRetries?: number | undefined;
    maxRetryDelayMs: number;
  } {
    return {
      maxRetries: this.manager.settings.retry?.provider?.maxRetries,
      maxRetryDelayMs:
        this.manager.settings.retry?.provider?.maxRetryDelayMs ??
        SETTINGS_DEFAULTS.retry.provider.maxRetryDelayMs,
      timeoutMs: this.manager.settings.retry?.provider?.timeoutMs,
    };
  }

  getDefaultProjectTrust(): settingsSchemaTypes.DefaultProjectTrust {
    const value = this.manager.globalSettings.defaultProjectTrust;
    return value === "always" || value === "never" ? value : SETTINGS_DEFAULTS.defaultProjectTrust;
  }

  getPrWatchIntervalMs(): number {
    const seconds = this.manager.settings.prWatch?.intervalSeconds;
    const value =
      typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 5
        ? seconds
        : SETTINGS_DEFAULTS.prWatch.intervalSeconds;
    return Math.round(value * 1000);
  }

  getPrWatchStatusIntervalMs(): number {
    const seconds = this.manager.settings.prWatch?.statusIntervalSeconds;
    const value =
      typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 30
        ? seconds
        : SETTINGS_DEFAULTS.prWatch.statusIntervalSeconds;
    return Math.round(value * 1000);
  }

  setSteeringMode(mode: "all" | "one-at-a-time"): void {
    this.manager.persistence.setGlobalSetting("steeringMode", mode);
  }

  setFollowUpMode(mode: "all" | "one-at-a-time"): void {
    this.manager.persistence.setGlobalSetting("followUpMode", mode);
  }

  setCacheWarmingMode(mode: settingsSchemaTypes.CacheWarmingMode): void {
    this.manager.persistence.setGlobalSetting("cacheWarming", mode);
  }

  setDefaultProjectTrust(defaultProjectTrust: settingsSchemaTypes.DefaultProjectTrust): void {
    this.manager.persistence.setGlobalSetting("defaultProjectTrust", defaultProjectTrust);
  }

  getOrchestratorDatabasePath(): string {
    const configured = this.manager.settings.orchestrator?.database?.trim();
    const agentDir =
      this.manager.settingsPaths.global !== undefined && this.manager.settingsPaths.global !== ""
        ? dirname(this.manager.settingsPaths.global)
        : getAgentDir();
    return configured !== undefined && configured !== ""
      ? resolvePath(configured, agentDir)
      : join(agentDir, "orchestrator.db");
  }

  getHandoffDirectory(): string {
    const agentDir =
      this.manager.settingsPaths.global !== undefined && this.manager.settingsPaths.global !== ""
        ? dirname(this.manager.settingsPaths.global)
        : getAgentDir();
    return join(agentDir, "handoffs");
  }

  getHttpIdleTimeoutMs(): number {
    return (
      parseTimeoutSetting(this.manager.settings.httpIdleTimeoutMs, "httpIdleTimeoutMs") ??
      DEFAULT_HTTP_IDLE_TIMEOUT_MS
    );
  }

  setHttpIdleTimeoutMs(timeoutMs: number): void {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new Error(`Invalid httpIdleTimeoutMs setting: ${String(timeoutMs)}`);
    }
    this.manager.persistence.setGlobalSetting("httpIdleTimeoutMs", Math.floor(timeoutMs));
  }

  setRetryEnabled(enabled: boolean): void {
    this.manager.persistence.setNestedGlobalSetting("retry", "enabled", enabled);
  }
}
