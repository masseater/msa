import builtinTools from "./builtin-tools.ts";
import fileMutationQueue from "./file-mutation-queue.ts";
import registry from "./registry.ts";
import toolTypes from "./tool-types.ts";
import truncate from "./truncate.ts";

const tools = {
  DEFAULT_MAX_BYTES: truncate.DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES: truncate.DEFAULT_MAX_LINES,
  allToolNames: toolTypes.allToolNames,
  createAllToolDefinitions: registry.createAllToolDefinitions,
  createAllTools: registry.createAllTools,
  createBashTool: builtinTools.createBashTool,
  createBashToolDefinition: builtinTools.createBashToolDefinition,
  createCodingToolDefinitions: registry.createCodingToolDefinitions,
  createCodingTools: registry.createCodingTools,
  createEditTool: builtinTools.createEditTool,
  createEditToolDefinition: builtinTools.createEditToolDefinition,
  createFindTool: builtinTools.createFindTool,
  createFindToolDefinition: builtinTools.createFindToolDefinition,
  createGrepTool: builtinTools.createGrepTool,
  createGrepToolDefinition: builtinTools.createGrepToolDefinition,
  createLocalBashOperations: builtinTools.createLocalBashOperations,
  createLocalPowerShellOperations: builtinTools.createLocalPowerShellOperations,
  createLsTool: builtinTools.createLsTool,
  createLsToolDefinition: builtinTools.createLsToolDefinition,
  createPowerShellTool: builtinTools.createPowerShellTool,
  createPowerShellToolDefinition: builtinTools.createPowerShellToolDefinition,
  createReadOnlyToolDefinitions: registry.createReadOnlyToolDefinitions,
  createReadOnlyTools: registry.createReadOnlyTools,
  createReadTool: builtinTools.createReadTool,
  createReadToolDefinition: builtinTools.createReadToolDefinition,
  createTool: registry.createTool,
  createToolDefinition: registry.createToolDefinition,
  createWriteTool: builtinTools.createWriteTool,
  createWriteToolDefinition: builtinTools.createWriteToolDefinition,
  formatSize: truncate.formatSize,
  truncateHead: truncate.truncateHead,
  truncateLine: truncate.truncateLine,
  truncateTail: truncate.truncateTail,
  withFileMutationQueue: fileMutationQueue.withFileMutationQueue,
};

export default tools;
