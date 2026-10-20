import type agentTypes from "@msa/agent-core/index.types";
import type mcpTypes from "@msa/mcp/index.types";
import type { Effect } from "effect";

import awaitingModule from "../../core/awaiting.ts";
import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import type configTypes from "./config.types.ts";
import type toolsTypes from "./tools.types.ts";

const { awaited } = awaitingModule;

function* createMcpToolDefinitionPart1(
  client: toolsTypes.McpToolCaller,
  tool: mcpTypes.Tool,
  params: unknown,
  signal: AbortSignal | undefined,
  onUpdate: agentTypes.AgentToolUpdateCallback<toolsTypes.McpToolDetails> | undefined,
  server: string,
  options: {
    server: string;
    tool: mcpTypes.Tool;
    name: string;
    exposure: configTypes.McpExposure;
    namespace: extensionsTypesTypes.ToolNamespace;
    timeoutMs: number;
    getClient: () => Promise<toolsTypes.McpToolCaller>;
    readableResources?: () => boolean;
  },
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
      timeoutMs: options.timeoutMs,
    }),
  );
}

const toolsPart8 = {
  createMcpToolDefinitionPart1,
};

export default toolsPart8;
