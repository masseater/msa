import type aiTypes from "@msa/ai/index.types";

import httpDispatcher from "../../../core/http-dispatcher.ts";
import settingsManagerSupport from "../../../core/settings-manager-support.ts";
import type settingsManagerTypes from "../../../core/settings-manager.types.ts";
import settingEntry from "./setting-entry.ts";
import type settingsSelectorTypes from "./settings-selector.types.ts";

type Config = settingsSelectorTypes.SettingsConfig;
type SettingEntry = settingsSelectorTypes.SettingEntry;
type DeliveryMode = "all" | "one-at-a-time";
type TreeFilterMode = Config["treeFilterMode"];

const { choice, toggle } = settingEntry;
const { HTTP_IDLE_TIMEOUT_CHOICES, formatHttpIdleTimeoutMs } = httpDispatcher;

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

const DELIVERY_MODES: DeliveryMode[] = ["one-at-a-time", "all"];
const DELIVERY_SUFFIX =
  "'one-at-a-time': deliver one, wait for response. 'all': deliver all at once.";

function autoCompactEntry(config: Config): SettingEntry {
  return toggle(
    {
      description: "Automatically compact context when it gets too large",
      id: "autocompact",
      label: "Auto-compact",
    },
    config.autoCompact,
    (c, v) => c.onAutoCompactChange(v),
  );
}

function deliveryEntries(config: Config, followUpKey: string): SettingEntry[] {
  return [
    choice(
      {
        description: `Enter while streaming queues steering messages. ${DELIVERY_SUFFIX}`,
        id: "steering-mode",
        label: "Steering mode",
      },
      config.steeringMode,
      DELIVERY_MODES,
      (c, v) => c.onSteeringModeChange(v),
    ),
    choice(
      {
        description: `${followUpKey} queues follow-up messages until agent stops. ${DELIVERY_SUFFIX}`,
        id: "follow-up-mode",
        label: "Follow-up mode",
      },
      config.followUpMode,
      DELIVERY_MODES,
      (c, v) => c.onFollowUpModeChange(v),
    ),
  ];
}

function transportEntries(config: Config): SettingEntry[] {
  return [
    choice<aiTypes.Transport>(
      {
        description: "Preferred transport for providers that support multiple transports",
        id: "transport",
        label: "Transport",
      },
      config.transport,
      ["sse", "websocket", "websocket-cached", "auto"],
      (c, v) => c.onTransportChange(v),
    ),
    {
      apply: (value, callbacks) => {
        const selected = HTTP_IDLE_TIMEOUT_CHOICES.find((item) => item.label === value);
        if (selected !== undefined) callbacks.onHttpIdleTimeoutMsChange(selected.timeoutMs);
      },
      item: {
        currentValue: formatHttpIdleTimeoutMs(config.httpIdleTimeoutMs),
        description:
          "Maximum idle gap while waiting for HTTP headers or body chunks. Disable for local models that pause longer than five minutes.",
        id: "http-idle-timeout",
        label: "HTTP idle timeout",
        values: HTTP_IDLE_TIMEOUT_CHOICES.map((item) => item.label),
      },
    },
    choice<settingsManagerTypes.CacheWarmingMode>(
      {
        description:
          "off; streaming while the agent runs; idle also between runs while continuation stays profitable",
        id: "cache-warming-mode",
        label: "Cache warming",
      },
      config.cacheWarmingMode,
      settingsManagerSupport.CACHE_WARMING_MODES,
      (c, v) => c.onCacheWarmingModeChange(v),
    ),
  ];
}

function transcriptEntries(config: Config): SettingEntry[] {
  return [
    toggle(
      {
        description: "Hide thinking blocks in assistant responses",
        id: "hide-thinking",
        label: "Hide thinking",
      },
      config.hideThinkingBlock,
      (c, v) => c.onHideThinkingBlockChange(v),
    ),
    choice<settingsManagerTypes.MermaidRenderingMode>(
      {
        description: "Render Mermaid code blocks as Unicode diagrams",
        id: "mermaid-rendering",
        label: "Mermaid diagrams",
      },
      config.mermaidRenderingMode,
      ["off", "final", "streaming"],
      (c, v) => c.onMermaidRenderingModeChange(v),
    ),
    toggle(
      {
        description: "Show transcript notices for cache costs and provider recovery diagnostics",
        id: "cache-miss-notices",
        label: "Cache miss notices",
      },
      config.showCacheMissNotices,
      (c, v) => c.onShowCacheMissNoticesChange(v),
    ),
    toggle(
      {
        description: "Show condensed changelog after updates",
        id: "collapse-changelog",
        label: "Collapse changelog",
      },
      config.collapseChangelog,
      (c, v) => c.onCollapseChangelogChange(v),
    ),
  ];
}

function startupEntries(config: Config): SettingEntry[] {
  return [
    {
      apply: (value, callbacks) =>
        callbacks.onQuietStartupChange(value === "header" ? "header" : value === "true"),
      item: {
        currentValue: String(config.quietStartup),
        description: "Disable verbose printing at startup (header: keep only the startup header)",
        id: "quiet-startup",
        label: "Quiet startup",
        values: ["true", "header", "false"],
      },
    },
    toggle(
      {
        description: "Send attribution headers to OpenRouter",
        id: "install-telemetry",
        label: "Provider attribution",
      },
      config.enableInstallTelemetry,
      (c, v) => c.onEnableInstallTelemetryChange(v),
    ),
    {
      apply: (value, callbacks) => {
        const trust = DEFAULT_PROJECT_TRUST_BY_LABEL.get(value);
        if (trust !== undefined) callbacks.onDefaultProjectTrustChange(trust);
      },
      item: {
        currentValue: DEFAULT_PROJECT_TRUST_LABELS[config.defaultProjectTrust],
        description:
          "Fallback behavior when no extension or saved trust decision decides project trust",
        id: "default-project-trust",
        label: "Default project trust",
        values: Object.values(DEFAULT_PROJECT_TRUST_LABELS),
      },
    },
  ];
}

function navigationEntries(config: Config): SettingEntry[] {
  return [
    {
      apply: (value, callbacks) => callbacks.onDoubleEscapeActionChange(value as "fork" | "tree"),
      item: {
        currentValue: config.doubleEscapeAction,
        description: "Action when pressing Escape twice with empty editor",
        id: "double-escape-action",
        label: "Double-escape action",
        values: ["tree", "fork", "none"],
      },
    },
    choice<TreeFilterMode>(
      {
        description: "Default filter when opening /rewind",
        id: "tree-filter-mode",
        label: "Tree filter mode",
      },
      config.treeFilterMode,
      ["default", "no-tools", "user-only", "labeled-only", "all"],
      (c, v) => c.onTreeFilterModeChange(v),
    ),
  ];
}

function sessionEntries(config: Config, followUpKey: string): SettingEntry[] {
  return [
    ...deliveryEntries(config, followUpKey),
    ...transportEntries(config),
    ...transcriptEntries(config),
    ...startupEntries(config),
    ...navigationEntries(config),
  ];
}

const settingsBehaviorEntries = {
  autoCompactEntry,
  sessionEntries,
};

export default settingsBehaviorEntries;
