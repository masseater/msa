import agentModule from "@msa/agent-core";
import compat from "@msa/ai/compat";

import sdkPart4 from "./sdk-part4.ts";
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
const { createAgentSession } = sdkPart4;

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
