import agentModule from "@msa/agent-core";
import compat from "@msa/ai/compat";

import createAgentSessionModule from "./sdk/create-agent-session.ts";
import toolsModule from "./tools/index.ts";

const {
  createBashTool,
  createCodingTools,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createPowerShellTool,
  createReadOnlyTools,
  createReadTool,
  createWriteTool,
  withFileMutationQueue,
} = toolsModule;
const { setDefaultStreamFn } = agentModule;
const { streamSimple } = compat;
const { createAgentSession } = createAgentSessionModule;

setDefaultStreamFn(streamSimple);

const sdk = {
  createAgentSession,
  createBashTool,
  createCodingTools,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createPowerShellTool,
  createReadOnlyTools,
  createReadTool,
  createWriteTool,
  withFileMutationQueue,
};

export default sdk;
