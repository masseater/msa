import type { TSchema } from "typebox";

import type typesToolsTypes from "./types-tools.types.ts";

function defineTool<TParams extends TSchema, TDetails = unknown, TState = any>(
  tool: typesToolsTypes.ToolDefinition<TParams, TDetails, TState>,
): typesToolsTypes.ToolDefinition<TParams, TDetails, TState> & typesToolsTypes.AnyToolDefinition {
  return tool as typesToolsTypes.ToolDefinition<TParams, TDetails, TState> &
    typesToolsTypes.AnyToolDefinition;
}

const typesTools = {
  defineTool,
};

export default typesTools;
