import srcConfig from "../../../config.ts";
import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";
import configModule from "../config.ts";
import type configTypes from "../config.types.ts";

const { getAgentDir } = srcConfig;
const { loadMcpConfig } = configModule;

function defaultLoadConfig(
  ctx: extensionsTypesTypes.ExtensionContext,
): configTypes.LoadedMcpConfig {
  return loadMcpConfig({
    agentDir: getAgentDir(),
    cwd: ctx.cwd,
    projectTrusted: ctx.isProjectTrusted(),
  });
}

const sessionConfig = { defaultLoadConfig };

export default sessionConfig;
