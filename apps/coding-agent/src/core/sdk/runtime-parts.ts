import config from "../../config.ts";
import paths from "../../utils/paths.ts";
import awaitingModule from "../awaiting.ts";
import ModelRuntime from "../model-runtime.ts";
import platformNode from "../platform-node.ts";
import SessionManager from "../session-manager.ts";
import sessionFiles from "../session-manager/session-files.ts";
import SettingsManager from "../settings-manager.ts";
import type sdkInternalTypes from "./sdk-internal.types.ts";

const { getAgentDir } = config;
const { awaited } = awaitingModule;
const { resolvePath } = paths;
const { join } = platformNode;
const { getDefaultSessionDir } = sessionFiles;

function* createRuntimeParts(options: sdkInternalTypes.Options) {
  const cwd = resolvePath(options.cwd ?? options.sessionManager?.getCwd() ?? process.cwd());
  const customAgentDir = options.agentDir !== undefined && options.agentDir !== "";
  const agentDir = customAgentDir ? resolvePath(options.agentDir!) : getAgentDir();
  const modelRuntime =
    options.modelRuntime ??
    (yield* awaited(
      ModelRuntime.create({
        authPath: customAgentDir ? join(agentDir, "auth.json") : undefined,
        modelsPath: customAgentDir ? join(agentDir, "models.json") : undefined,
      }),
    ));
  const settingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir);
  modelRuntime.setModelPolicy(settingsManager.models.getModelPolicy());
  const sessionManager =
    options.sessionManager ?? SessionManager.create(cwd, getDefaultSessionDir(cwd, agentDir));
  const runtime: sdkInternalTypes.SdkRuntime = {
    agentDir,
    cwd,
    modelRuntime,
    options,
    sessionManager,
    settingsManager,
  };
  return runtime;
}

const runtimeParts = { createRuntimeParts };

export default runtimeParts;
