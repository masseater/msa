import type agentTypes from "@msa/agent-core/index.types";
import type mcpTypes from "@msa/mcp/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../../../core/awaiting.ts";
import type toolsTypes from "../tools.types.ts";
import resultContent from "./result-content.ts";
import resultSchema from "./result-schema.ts";
import toolRenderers from "./tool-renderers.ts";
import toolShape from "./tool-shape.ts";

const { awaiting, awaited } = awaitingModule;
const { convertMcpResult } = resultContent;
const { createMcpToolRenderers } = toolRenderers;
const { toParameters, toToolExposure, toToolAnnotations } = toolShape;
const { createMcpResultSchema } = resultSchema;

function* callWithProgress(
  client: toolsTypes.McpToolCaller,
  tool: mcpTypes.Tool,
  params: unknown,
  signal: AbortSignal | undefined,
  onUpdate: agentTypes.AgentToolUpdateCallback<toolsTypes.McpToolDetails> | undefined,
  server: string,
  timeoutMs: number,
): Generator<Effect.Effect<unknown>, mcpTypes.CallToolResult, unknown> {
  return yield* awaited(
    client.callTool(tool.name, (params ?? {}) as Record<string, unknown>, {
      ...(signal === undefined ? {} : { signal }),
      onProgress: (progress) => {
        const total = progress.total === undefined ? "" : `/${progress.total}`;
        const text = progress.message ?? `Progress ${progress.progress}${total}`;
        onUpdate?.({
          content: [{ text, type: "text" }],
          details: { server, tool: tool.name },
        });
      },
      timeoutMs,
    }),
  );
}

function createMcpToolDefinition(
  options: toolsTypes.McpToolDefinitionOptions,
): toolsTypes.McpToolDefinition {
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
          const result = yield* callWithProgress(
            client,
            tool,
            params,
            signal,
            onUpdate,
            server,
            options.timeoutMs,
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

const toolDefinition = { createMcpToolDefinition };

export default toolDefinition;
