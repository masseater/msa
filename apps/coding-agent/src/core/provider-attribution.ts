import type aiTypes from "@msa/ai/index.types";

import config from "../config.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";
import telemetry from "./telemetry.ts";

const { isInstallTelemetryEnabled } = telemetry;
const { APP_NAME } = config;

const APP_URL = "https://github.com/masseater/msa";
const OPENROUTER_HOST = "openrouter.ai";
const OPENCODE_HOST = "opencode.ai";

function matchesHost(baseUrl: string, expectedHost: string): boolean {
  try {
    return new URL(baseUrl).hostname === expectedHost;
  } catch {
    return false;
  }
}

function isOpenRouterModel(model: aiTypes.Model<aiTypes.Api>): boolean {
  return model.provider === "openrouter" || model.baseUrl.includes(OPENROUTER_HOST);
}

function getDefaultAttributionHeaders(
  model: aiTypes.Model<aiTypes.Api>,
  settingsManager: settingsManagerTypes.SettingsManager,
): Record<string, string> | undefined {
  if (!isInstallTelemetryEnabled(settingsManager)) {
    return undefined;
  }

  if (isOpenRouterModel(model)) {
    return {
      "HTTP-Referer": APP_URL,
      "X-OpenRouter-Categories": "cli-agent",
      "X-OpenRouter-Title": APP_NAME,
    };
  }

  return undefined;
}

function getSessionHeaders(
  model: aiTypes.Model<aiTypes.Api>,
  sessionId: string | undefined,
): Record<string, string> | undefined {
  if (sessionId === undefined || sessionId === "") return undefined;
  if (
    model.provider !== "opencode" &&
    model.provider !== "opencode-go" &&
    !matchesHost(model.baseUrl, OPENCODE_HOST)
  ) {
    return undefined;
  }
  return { "x-opencode-client": APP_NAME, "x-opencode-session": sessionId };
}

function mergeProviderAttributionHeaders(
  model: aiTypes.Model<aiTypes.Api>,
  settingsManager: settingsManagerTypes.SettingsManager,
  sessionId: string | undefined,
  ...headerSources: Array<aiTypes.ProviderHeaders | undefined>
): aiTypes.ProviderHeaders | undefined {
  const merged: aiTypes.ProviderHeaders = Object.fromEntries(
    [
      getSessionHeaders(model, sessionId),
      getDefaultAttributionHeaders(model, settingsManager),
      ...headerSources,
    ].flatMap((headers) => Object.entries(headers ?? {})),
  );

  return Object.keys(merged).length > 0 ? merged : undefined;
}

const providerAttribution = {
  mergeProviderAttributionHeaders,
};

export default providerAttribution;
