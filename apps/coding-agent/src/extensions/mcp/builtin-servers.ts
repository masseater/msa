import memory from "../../core/memory/memory.ts";
import platform from "../../core/platform/index.ts";
import ProjectTrustStore from "../../core/project-trust-store.ts";
import SettingsManager from "../../core/settings-manager.ts";
import type settingsManagerTypes from "../../core/settings-manager.types.ts";
import type configTypes from "./config.types.ts";

const { join } = platform;
const { SEPIACE_SERVER_NAME, SEPIACE_URL, resolveMemorySettings } = memory;

function sepiaceEntry(agentDir: string): configTypes.McpServerEntry {
  return {
    config: {
      description: "sepiace long-term memory, reached through the memory tool",
      exposure: "hidden",
      url: SEPIACE_URL,
    },
    name: SEPIACE_SERVER_NAME,
    scope: "builtin",
    source: join(agentDir, "mcp.json"),
  };
}

function builtinServers(
  agentDir: string,
  settings: settingsManagerTypes.Settings,
): configTypes.McpServerEntry[] {
  const entry = sepiaceEntry(agentDir);
  return resolveMemorySettings(settings).enabled
    ? [entry]
    : [{ ...entry, config: { ...entry.config, enabled: false } }];
}

function shellBuiltinServers(cwd: string, agentDir: string): Promise<configTypes.McpServerEntry[]> {
  return new ProjectTrustStore(agentDir)
    .get(cwd)
    .then((trusted) => SettingsManager.create(cwd, agentDir, { projectTrusted: trusted === true }))
    .then((settings) => builtinServers(agentDir, settings.settings));
}

const builtinServersModule = { builtinServers, sepiaceEntry, shellBuiltinServers };

export default builtinServersModule;
