import ExtensionRunner from "./extension-runner.ts";
import loader from "./loader.ts";
import extensionsTypesModule from "./types.ts";
import wrapper from "./wrapper.ts";

const extensions = {
  ExtensionRunner: ExtensionRunner,
  createExtensionRuntime: loader.createExtensionRuntime,
  defineTool: extensionsTypesModule.defineTool,
  discoverAndLoadExtensions: loader.discoverAndLoadExtensions,
  isBashToolResult: extensionsTypesModule.isBashToolResult,
  isEditToolResult: extensionsTypesModule.isEditToolResult,
  isFindToolResult: extensionsTypesModule.isFindToolResult,
  isGrepToolResult: extensionsTypesModule.isGrepToolResult,
  isLsToolResult: extensionsTypesModule.isLsToolResult,
  isPowerShellToolResult: extensionsTypesModule.isPowerShellToolResult,
  isReadToolResult: extensionsTypesModule.isReadToolResult,
  isToolCallEventType: extensionsTypesModule.isToolCallEventType,
  isWriteToolResult: extensionsTypesModule.isWriteToolResult,
  loadExtensionFromFactory: loader.loadExtensionFromFactory,
  loadExtensions: loader.loadExtensions,
  wrapRegisteredTool: wrapper.wrapRegisteredTool,
  wrapRegisteredTools: wrapper.wrapRegisteredTools,
};

export default extensions;
