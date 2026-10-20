import agentSessionRuntimeSupport from "./core/agent-session-runtime-support.ts";
import agentSessionServices from "./core/agent-session-services.ts";
import eventBus from "./core/event-bus.ts";
import messages from "./core/messages.ts";
import sdk from "./core/sdk.ts";
import virtualModels from "./core/virtual-models.ts";
import codemodeExtension from "./extensions/codemode/extension.ts";
import clipboard from "./utils/clipboard.ts";
import imageConvert from "./utils/image-convert.ts";

const { createCodemodeExtension: createCodemodeExtensionModule } = codemodeExtension;

const indexKitPart3 = {
  VIRTUAL_MODEL_STATE_ENTRY: virtualModels.VIRTUAL_MODEL_STATE_ENTRY,
  convertToLlm: messages.convertToLlm,
  convertToPng: imageConvert.convertToPng,
  copyToClipboard: clipboard.copyToClipboard,
  createAgentSession: sdk.createAgentSession,
  createAgentSessionFromServices: agentSessionServices.createAgentSessionFromServices,
  createAgentSessionRuntime: agentSessionRuntimeSupport.createAgentSessionRuntime,
  createAgentSessionServices: agentSessionServices.createAgentSessionServices,
  createBashTool: sdk.createBashTool,
  createCodemodeExtension: createCodemodeExtensionModule,
  createCodingTools: sdk.createCodingTools,
  createEditTool: sdk.createEditTool,
  createEventBus: eventBus.createEventBus,
  createFindTool: sdk.createFindTool,
  createGrepTool: sdk.createGrepTool,
  createLsTool: sdk.createLsTool,
  createPowerShellTool: sdk.createPowerShellTool,
  createReadOnlyTools: sdk.createReadOnlyTools,
  createReadTool: sdk.createReadTool,
  createWriteTool: sdk.createWriteTool,
};

export default indexKitPart3;
