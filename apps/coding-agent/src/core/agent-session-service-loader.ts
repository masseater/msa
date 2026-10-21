import configModule from "../config.ts";
import paths from "../utils/paths.ts";
import type agentSessionServicesTypes from "./agent-session-services.types.ts";
import awaitingModule from "./awaiting.ts";
import DefaultResourceLoader from "./default-resource-loader.ts";
import ModelRuntime from "./model-runtime.ts";
import platformNode from "./platform-node.ts";
import SettingsManager from "./settings-manager.ts";

const { awaited } = awaitingModule;
const { resolvePath } = paths;
const { getAgentDir } = configModule;
const { join } = platformNode;

function* loadAgentSessionServices(
  options: agentSessionServicesTypes.CreateAgentSessionServicesOptions,
) {
  const cwd = resolvePath(options.cwd);
  const agentDir =
    options.agentDir !== undefined && options.agentDir !== ""
      ? resolvePath(options.agentDir)
      : getAgentDir();
  const modelRuntime =
    options.modelRuntime ??
    (yield* awaited(
      ModelRuntime.create({
        authPath: join(agentDir, "auth.json"),
        modelsPath: join(agentDir, "models.json"),
        signal: options.modelRuntimeSignal,
      }),
    ));
  const settingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir);
  modelRuntime.setModelPolicy(settingsManager.models.getModelPolicy());
  const resourceLoader = new DefaultResourceLoader({
    ...(options.resourceLoaderOptions ?? {}),
    agentDir,
    cwd,
    settingsManager,
  });
  yield* awaited(resourceLoader.reload(options.resourceLoaderReloadOptions));
  return { agentDir, cwd, modelRuntime, resourceLoader, settingsManager };
}

const agentSessionServiceLoader = { loadAgentSessionServices };

export default agentSessionServiceLoader;
