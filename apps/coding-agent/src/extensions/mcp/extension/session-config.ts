import srcConfig from "../../../config.ts";
import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";
import platform from "../../../core/platform/index.ts";
import type settingsManagerTypes from "../../../core/settings-manager.types.ts";
import builtinServersModule from "../builtin-servers.ts";
import configModule from "../config.ts";
import type configTypes from "../config.types.ts";

const { getAgentDir } = srcConfig;
const { loadMcpConfig } = configModule;
const { builtinServers } = builtinServersModule;
const { writeError } = platform;

function defaultLoadConfig(
  ctx: extensionsTypesTypes.ExtensionContext,
  settings: settingsManagerTypes.Settings,
): Promise<configTypes.LoadedMcpConfig> {
  const agentDir = getAgentDir();
  return loadMcpConfig({
    agentDir,
    builtins: builtinServers(agentDir, settings),
    cwd: ctx.cwd,
    projectTrusted: ctx.isProjectTrusted(),
  });
}

function signInStorageWarning(
  ctx: extensionsTypesTypes.ExtensionContext,
  signal: AbortSignal,
): (notice: string) => void {
  return (notice) => {
    if (signal.aborted) return;
    if (!ctx.hasUI) {
      writeError(`Warning: ${notice}`);
      return;
    }
    try {
      ctx.ui.notify(notice, "warning");
    } catch {}
  };
}

const sessionConfig = { defaultLoadConfig, signInStorageWarning };

export default sessionConfig;
