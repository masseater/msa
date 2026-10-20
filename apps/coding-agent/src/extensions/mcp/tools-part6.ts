import type agentTypes from "@msa/agent-core/index.types";
import type mcpTypes from "@msa/mcp/index.types";
import { dual } from "effect/Function";
import type { TSchema } from "typebox";

import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import toolsPart5 from "./tools-part5.ts";
import type toolsTypes from "./tools.types.ts";

const { convertMcpResultImpl } = toolsPart5;

const convertMcpResult: {
  (
    server: string,
    tool: string,
    result: mcpTypes.CallToolResult,
    options?: toolsTypes.ConvertMcpResultOptions,
  ): Promise<agentTypes.AgentToolResult<toolsTypes.McpToolDetails>>;
  (
    tool: string,
    result: mcpTypes.CallToolResult,
    options?: toolsTypes.ConvertMcpResultOptions,
  ): (server: string) => Promise<agentTypes.AgentToolResult<toolsTypes.McpToolDetails>>;
} = dual((args: IArguments) => args.length >= 3, convertMcpResultImpl);

function toParameters(schema: Record<string, unknown>): TSchema {
  return {
    ...schema,
    type: schema["type"] ?? "object",
    ...(schema["properties"] === undefined ? { properties: {} } : {}),
  } as unknown as TSchema;
}

const ANNOTATION_HINTS = [
  "readOnlyHint",
  "destructiveHint",
  "idempotentHint",
  "openWorldHint",
] as const;

function toToolAnnotations(tool: mcpTypes.Tool): extensionsTypesTypes.ToolAnnotations | undefined {
  const annotations: extensionsTypesTypes.ToolAnnotations = {};
  for (const hint of ANNOTATION_HINTS) {
    const value = tool.annotations?.[hint];
    if (typeof value === "boolean") annotations[hint] = value;
  }
  return Object.keys(annotations).length > 0 ? annotations : undefined;
}

const toolsPart6 = {
  convertMcpResult,
  toParameters,
  toToolAnnotations,
};

export default toolsPart6;
