import type { Api, Model, ProviderHeaders } from "@msa/ai";

import type { SettingsManager } from "./settings-manager.ts";
import { isInstallTelemetryEnabled } from "./telemetry.ts";

const OPENROUTER_HOST = "openrouter.ai";
const OPENCODE_HOST = "opencode.ai";

function matchesHost(baseUrl: string, expectedHost: string): boolean {
  try {
    return new URL(baseUrl).hostname === expectedHost;
  } catch {
    return false;
  }
}

function isOpenRouterModel(model: Model<Api>): boolean {
  return model.provider === "openrouter" || model.baseUrl.includes(OPENROUTER_HOST);
}

function getDefaultAttributionHeaders(
  model: Model<Api>,
  settingsManager: SettingsManager,
): Record<string, string> | undefined {
  if (!isInstallTelemetryEnabled(settingsManager)) {
    return undefined;
  }

  if (isOpenRouterModel(model)) {
    return {
      "HTTP-Referer": "https://pi.dev",
      "X-OpenRouter-Title": "pi",
      "X-OpenRouter-Categories": "cli-agent",
    };
  }

  return undefined;
}

function getSessionHeaders(
  model: Model<Api>,
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
  return { "x-opencode-session": sessionId, "x-opencode-client": "pi" };
}

export function mergeProviderAttributionHeaders(
  model: Model<Api>,
  settingsManager: SettingsManager,
  sessionId: string | undefined,
  ...headerSources: Array<ProviderHeaders | undefined>
): ProviderHeaders | undefined {
  const merged: ProviderHeaders = {
    ...getSessionHeaders(model, sessionId),
    ...getDefaultAttributionHeaders(model, settingsManager),
  };

  for (const headers of headerSources) {
    if (headers !== undefined) {
      Object.assign(merged, headers);
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}
