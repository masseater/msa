import eventBus from "../core/event-bus.ts";
import extensions from "../core/extensions/index.ts";
import codemodeExtension from "../extensions/codemode/extension.ts";
import mcpExtension from "../extensions/mcp/extension.ts";
import toolSearchExtension from "../extensions/tool-search/extension.ts";

const { createCodemodeExtension: createCodemodeExtensionModule } = codemodeExtension;
const { createMcpExtension: createMcpExtensionModule } = mcpExtension;
const { createToolSearchExtension: createToolSearchExtensionModule } = toolSearchExtension;

const extensionsKit: {
  readonly ExtensionRunner: typeof extensions.ExtensionRunner;
  readonly createCodemodeExtension: typeof createCodemodeExtensionModule;
  readonly createEventBus: typeof eventBus.createEventBus;
  readonly createExtensionRuntime: typeof extensions.createExtensionRuntime;
  readonly createMcpExtension: typeof createMcpExtensionModule;
  readonly createToolSearchExtension: typeof createToolSearchExtensionModule;
  readonly defineTool: typeof extensions.defineTool;
  readonly discoverAndLoadExtensions: typeof extensions.discoverAndLoadExtensions;
  readonly isBashToolResult: typeof extensions.isBashToolResult;
  readonly isEditToolResult: typeof extensions.isEditToolResult;
  readonly isFindToolResult: typeof extensions.isFindToolResult;
  readonly isGrepToolResult: typeof extensions.isGrepToolResult;
  readonly isLsToolResult: typeof extensions.isLsToolResult;
  readonly isPowerShellToolResult: typeof extensions.isPowerShellToolResult;
  readonly isReadToolResult: typeof extensions.isReadToolResult;
  readonly isToolCallEventType: typeof extensions.isToolCallEventType;
  readonly isWriteToolResult: typeof extensions.isWriteToolResult;
  readonly wrapRegisteredTool: typeof extensions.wrapRegisteredTool;
  readonly wrapRegisteredTools: typeof extensions.wrapRegisteredTools;
} = {
  ExtensionRunner: extensions.ExtensionRunner,
  createCodemodeExtension: createCodemodeExtensionModule,
  createEventBus: eventBus.createEventBus,
  createExtensionRuntime: extensions.createExtensionRuntime,
  createMcpExtension: createMcpExtensionModule,
  createToolSearchExtension: createToolSearchExtensionModule,
  defineTool: extensions.defineTool,
  discoverAndLoadExtensions: extensions.discoverAndLoadExtensions,
  isBashToolResult: extensions.isBashToolResult,
  isEditToolResult: extensions.isEditToolResult,
  isFindToolResult: extensions.isFindToolResult,
  isGrepToolResult: extensions.isGrepToolResult,
  isLsToolResult: extensions.isLsToolResult,
  isPowerShellToolResult: extensions.isPowerShellToolResult,
  isReadToolResult: extensions.isReadToolResult,
  isToolCallEventType: extensions.isToolCallEventType,
  isWriteToolResult: extensions.isWriteToolResult,
  wrapRegisteredTool: extensions.wrapRegisteredTool,
  wrapRegisteredTools: extensions.wrapRegisteredTools,
};

export default extensionsKit;
