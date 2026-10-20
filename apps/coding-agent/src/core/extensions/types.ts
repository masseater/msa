import typesGuards from "./types-guards.ts";
import typesTools from "./types-tools.ts";

const extensionsTypes = {
  defineTool: typesTools.defineTool,
  isBashToolResult: typesGuards.isBashToolResult,
  isEditToolResult: typesGuards.isEditToolResult,
  isFindToolResult: typesGuards.isFindToolResult,
  isGrepToolResult: typesGuards.isGrepToolResult,
  isLsToolResult: typesGuards.isLsToolResult,
  isPowerShellToolResult: typesGuards.isPowerShellToolResult,
  isReadToolResult: typesGuards.isReadToolResult,
  isToolCallEventType: typesGuards.isToolCallEventType,
  isWriteToolResult: typesGuards.isWriteToolResult,
};

export default extensionsTypes;
