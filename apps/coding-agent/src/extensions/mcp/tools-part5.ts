import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import mcp from "@msa/mcp";
import type mcpTypes from "@msa/mcp/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import toolsPart1 from "./tools-part1.ts";
import toolsPart2 from "./tools-part2.ts";
import toolsPart4 from "./tools-part4.ts";
import type toolsTypes from "./tools.types.ts";

const { awaited, awaiting } = awaitingModule;
const { toLlmContent } = mcp;
const { toModelContent } = toolsPart4;
const { textOf } = toolsPart1;
const { limitMcpContent } = toolsPart2;

function convertMcpResultImpl(
  server: string,
  tool: string,
  result: mcpTypes.CallToolResult,
  options: toolsTypes.ConvertMcpResultOptions = {},
): Promise<agentTypes.AgentToolResult<toolsTypes.McpToolDetails>> {
  return Effect.runPromise(
    awaiting(function* () {
      const converted: (aiTypes.TextContent | aiTypes.ImageContent)[] =
        result.content.length > 0
          ? yield* awaited(toModelContent(server, result.content, options))
          : toLlmContent(result);
      if (result.isError === true && textOf(converted) === "") {
        converted.push({ text: `MCP tool ${server}/${tool} returned an error`, type: "text" });
      }
      const { content, fullOutputPath } = yield* awaited(
        limitMcpContent(converted, options.saveOutput),
      );
      const { _meta: _ignored, ...scriptResult } = result;
      return {
        content,
        details: {
          server,
          tool,
          ...(fullOutputPath !== undefined && fullOutputPath !== "" ? { fullOutputPath } : {}),
        },
        structuredContent: scriptResult as unknown as aiTypes.JsonValue,
        ...(result.isError === true ? { isError: true } : {}),
      };
    }),
  );
}

const toolsPart5 = {
  convertMcpResultImpl,
};

export default toolsPart5;
