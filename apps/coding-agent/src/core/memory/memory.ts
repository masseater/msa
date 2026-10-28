import settingsDefaults from "../settings-defaults.ts";
import type settingsManagerTypes from "../settings-manager.types.ts";
import type memoryTypes from "./memory.types.ts";

const { SETTINGS_DEFAULTS } = settingsDefaults;

const MEMORY_RECALL_MESSAGE_TYPE = "msa.memory.recall";
const SEPIACE_NAME = "sepiace";
const SEPIACE_URL = "https://hi.sepiace.io/api/v1/mcp";
const SEPIACE_HOST = new URL(SEPIACE_URL).host;
const SEPIACE_REQUESTS_URL = "https://hi.sepiace.io/requests";
const SEPIACE_TOOL = "memory";
const SIGN_IN_HINT = "sign in with /memory or msa memory login";

function resolveMemorySettings(
  settings: settingsManagerTypes.Settings,
): memoryTypes.ResolvedMemorySettings {
  const enabled = settings.memory?.enabled ?? SETTINGS_DEFAULTS.memory.enabled;
  return {
    enabled,
    recall:
      enabled && (settings.memory?.recall?.enabled ?? SETTINGS_DEFAULTS.memory.recall.enabled),
  };
}

function sepiaceUrl(globalSettings: settingsManagerTypes.Settings): string {
  const url = globalSettings.memory?.url?.trim();
  return url === undefined || url === "" ? SEPIACE_URL : url;
}

function isSepiaceServer(name: string, url: string | undefined): boolean {
  if (name === SEPIACE_NAME) return true;
  if (url === undefined) return false;
  try {
    return new URL(url).host === SEPIACE_HOST;
  } catch {
    return false;
  }
}

function notAnMcpServer(name: string): string | undefined {
  return name === SEPIACE_NAME
    ? `sepiace is long-term memory, not an MCP server; ${SIGN_IN_HINT}.`
    : undefined;
}

function ignoredMcpServerNotice(path: string, name: string): string {
  return `${path}: MCP server "${name}" is ignored, because long-term memory connects to sepiace itself; remove it, and use memory.enabled and memory.url in settings.json instead.`;
}

const memory = {
  MEMORY_RECALL_MESSAGE_TYPE,
  SEPIACE_NAME,
  SEPIACE_REQUESTS_URL,
  SEPIACE_TOOL,
  SEPIACE_URL,
  SIGN_IN_HINT,
  ignoredMcpServerNotice,
  isSepiaceServer,
  notAnMcpServer,
  resolveMemorySettings,
  sepiaceUrl,
};

export default memory;
