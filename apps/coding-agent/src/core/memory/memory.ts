import settingsDefaults from "../settings-defaults.ts";
import SettingsManager from "../settings-manager.ts";
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

function readSepiaceUrl(location: {
  readonly agentDir: string;
  readonly cwd: string;
}): Promise<string> {
  return SettingsManager.create(location.cwd, location.agentDir).then((settingsManager) =>
    sepiaceUrl(settingsManager.getGlobalSettings()),
  );
}

function webHost(text: string): string | undefined {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.host : undefined;
  } catch {
    return undefined;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function argUrls(arg: unknown): string[] {
  if (typeof arg !== "string") return [];
  const flagValue = arg.startsWith("-") && arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : "";
  return [arg, flagValue];
}

function serverUrls(config: unknown): string[] {
  if (!isRecord(config)) return [];
  const url = typeof config["url"] === "string" ? [config["url"]] : [];
  const args = Array.isArray(config["args"]) ? config["args"].flatMap(argUrls) : [];
  return [...url, ...args];
}

function isSepiaceServer(name: string, config: unknown, memoryUrl: string): boolean {
  if (name === SEPIACE_NAME) return true;
  const hosts = new Set([SEPIACE_HOST, webHost(memoryUrl)]);
  return serverUrls(config).some((url) => {
    const host = webHost(url);
    return host !== undefined && hosts.has(host);
  });
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
  readSepiaceUrl,
  resolveMemorySettings,
  sepiaceUrl,
};

export default memory;
