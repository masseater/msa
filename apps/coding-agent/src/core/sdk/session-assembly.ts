import AgentSession from "../agent-session.ts";
import DefaultResourceLoader from "../default-resource-loader.ts";
import type extensionsTypes from "../extensions/index.types.ts";
import type resourceLoaderTypes from "../resource-loader.types.ts";
import type createAgentModule from "./create-agent.ts";
import type sdkInternalTypes from "./sdk-internal.types.ts";
import type toolSelection from "./tool-selection.ts";
import workerSessions from "./worker-sessions.ts";

const { workerSessionFactory } = workerSessions;

type SessionParts = {
  runtime: sdkInternalTypes.SdkRuntime;
  resourceLoader: resourceLoaderTypes.ResourceLoader;
  created: ReturnType<(typeof createAgentModule)["createAgent"]>;
  tools: ReturnType<(typeof toolSelection)["selectTools"]>;
  extensionRunnerRef: { current?: extensionsTypes.ExtensionRunner };
  createAgentSession: sdkInternalTypes.CreateAgentSession;
};

function assembleSession(parts: SessionParts): AgentSession {
  const { runtime, resourceLoader, created, tools, extensionRunnerRef } = parts;
  const { agentDir, cwd, modelRuntime, options, sessionManager, settingsManager } = runtime;
  const session: AgentSession = new AgentSession({
    agent: created.agent,
    agentDir,
    allowedToolNames: tools.allowedToolNames,
    cacheWarmer: created.cacheWarmer,
    createWorkerSession:
      options.isWorker !== true && resourceLoader instanceof DefaultResourceLoader
        ? workerSessionFactory({
            agentDir,
            createAgentSession: parts.createAgentSession,
            modelRuntime,
            options,
            resourceLoader,
            session: () => session,
            sessionManager,
            settingsManager,
            toolModifiers: tools.toolModifiers,
          })
        : undefined,
    customTools: options.customTools,
    cwd,
    defaultToolModifiers: tools.toolModifiers,
    excludedToolNames: tools.excludedToolNames,
    extensionRunnerRef,
    initialActiveToolNames: tools.initialActiveToolNames,
    modelRuntime,
    resourceLoader,
    scopedModels: options.scopedModels,
    sessionManager,
    sessionStartEvent: options.sessionStartEvent,
    settingsManager,
    telemetry: options.telemetry,
    usesDefaultTools: tools.usesDefaultTools,
  });
  return session;
}

const sessionAssembly = { assembleSession };

export default sessionAssembly;
