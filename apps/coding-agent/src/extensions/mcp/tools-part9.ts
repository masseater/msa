import type mcpTypes from "@msa/mcp/index.types";
import * as Effect from "effect/Effect";
import type { TSchema } from "typebox";

import awaitingModule from "../../core/awaiting.ts";
import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import type configTypes from "./config.types.ts";
import toolsPart1 from "./tools-part1.ts";
import toolsPart6 from "./tools-part6.ts";
import toolsPart7 from "./tools-part7.ts";
import toolsPart8 from "./tools-part8.ts";
import type toolsTypes from "./tools.types.ts";

const { awaited, awaiting } = awaitingModule;
const { convertMcpResult, toParameters, toToolAnnotations } = toolsPart6;
const { createMcpResultSchema, toToolExposure } = toolsPart1;
const { createMcpToolRenderers } = toolsPart7;
const { createMcpToolDefinitionPart1 } = toolsPart8;

function createMcpToolDefinition(options: {
  server: string;
  tool: mcpTypes.Tool;
  name: string;
  exposure: configTypes.McpExposure;
  namespace: extensionsTypesTypes.ToolNamespace;
  timeoutMs: number;
  getClient: () => Promise<toolsTypes.McpToolCaller>;

  readableResources?: () => boolean;
}): extensionsTypesTypes.ToolDefinition<TSchema, toolsTypes.McpToolDetails> {
  const { server, tool } = options;
  const title = tool.title ?? tool.annotations?.title;
  const annotations = toToolAnnotations(tool);
  const label = `${server}/${tool.name}`;
  return {
    description: tool.description?.trim() || title || `MCP tool ${tool.name} from server ${server}`,
    exposure: toToolExposure(options.exposure),
    label,
    name: options.name,
    namespace: options.namespace,
    outputSchema: createMcpResultSchema(tool.outputSchema),
    parameters: toParameters(tool.inputSchema),
    ...(annotations === undefined ? {} : { annotations }),
    ...createMcpToolRenderers(label),
    execute(_toolCallId, params, signal, onUpdate) {
      return Effect.runPromise(
        awaiting(function* () {
          const client = yield* awaited(options.getClient());
          const result = yield* createMcpToolDefinitionPart1(
            client,
            tool,
            params,
            signal,
            onUpdate,
            server,
            options,
          );
          return yield* awaited(
            convertMcpResult(server, tool.name, result, {
              readableResources: options.readableResources?.(),
            }),
          );
        }),
      );
    },
  };
}

const toolsPart9 = {
  createMcpToolDefinition,
};

export default toolsPart9;
