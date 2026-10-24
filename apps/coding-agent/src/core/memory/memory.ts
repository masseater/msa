import settingsDefaults from "../settings-defaults.ts";
import type settingsManagerTypes from "../settings-manager.types.ts";
import type memoryTypes from "./memory.types.ts";

const { SETTINGS_DEFAULTS } = settingsDefaults;

const MEMORY_RECALL_MESSAGE_TYPE = "msa.memory.recall";
const SEPIACE_SERVER_NAME = "sepiace";
const SEPIACE_URL = "https://hi.sepiace.io/api/v1/mcp";
const SEPIACE_REQUESTS_URL = "https://hi.sepiace.io/requests";
const SEPIACE_TOOL = "memory";
const SEPIACE_TOOL_NAME = `mcp__${SEPIACE_SERVER_NAME}__${SEPIACE_TOOL}`;

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

const memory = {
  MEMORY_RECALL_MESSAGE_TYPE,
  SEPIACE_REQUESTS_URL,
  SEPIACE_SERVER_NAME,
  SEPIACE_TOOL,
  SEPIACE_TOOL_NAME,
  SEPIACE_URL,
  resolveMemorySettings,
};

export default memory;
