import agentSessionRuntimeSupport from "./agent-session-runtime-support.ts";
import AgentSessionRuntime from "./agent-session-runtime.ts";
import agentSessionServices from "./agent-session-services.ts";
import AgentSession from "./agent-session.ts";
import bashExecutor from "./bash-executor.ts";
import eventBus from "./event-bus.ts";
import experimental from "./experimental.ts";
import extensions from "./extensions/index.ts";
import sourceInfo from "./source-info.ts";

const core = {
  AgentSession: AgentSession,
  AgentSessionRuntime: AgentSessionRuntime,
  ExtensionRunner: extensions.ExtensionRunner,
  areExperimentalFeaturesEnabled: experimental.areExperimentalFeaturesEnabled,
  createAgentSessionFromServices: agentSessionServices.createAgentSessionFromServices,
  createAgentSessionRuntime: agentSessionRuntimeSupport.createAgentSessionRuntime,
  createAgentSessionServices: agentSessionServices.createAgentSessionServices,
  createEventBus: eventBus.createEventBus,
  createSyntheticSourceInfo: sourceInfo.createSyntheticSourceInfo,
  defineTool: extensions.defineTool,
  discoverAndLoadExtensions: extensions.discoverAndLoadExtensions,
  executeBashWithOperations: bashExecutor.executeBashWithOperations,
};

export default core;
