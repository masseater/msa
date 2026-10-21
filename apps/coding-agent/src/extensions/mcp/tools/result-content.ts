import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import mcp from "@msa/mcp";
import type mcpTypes from "@msa/mcp/index.types";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import awaitingModule from "../../../core/awaiting.ts";
import type toolsTypes from "../tools.types.ts";
import outputLimit from "./output-limit.ts";
import resourceBlocks from "./resource-blocks.ts";

const { toLlmContent } = mcp;
const { awaited, awaiting } = awaitingModule;
const { limitMcpContent, textOf } = outputLimit;
const { describeBinaryResource, describeResourceLink } = resourceBlocks;

function blockToContent(
  server: string,
  block: mcpTypes.ContentBlock,
  options: toolsTypes.ConvertMcpResultOptions,
): Promise<(aiTypes.TextContent | aiTypes.ImageContent)[]> {
  return Effect.runPromise(
    awaiting(function* () {
      if (block.type === "resource_link") {
        return [{ text: describeResourceLink(server, block, options), type: "text" as const }];
      }
      if (
        block.type === "resource" &&
        "blob" in block.resource &&
        block.resource.mimeType?.startsWith("image/") !== true
      ) {
        const text = yield* awaited(describeBinaryResource(block.resource, options));
        return [{ text, type: "text" as const }];
      }
      return toLlmContent({ content: [block] });
    }),
  );
}

function toModelContentImpl(
  server: string,
  blocks: readonly mcpTypes.ContentBlock[],
  options: toolsTypes.ConvertMcpResultOptions = {},
): Promise<(aiTypes.TextContent | aiTypes.ImageContent)[]> {
  return Effect.runPromise(
    awaiting(function* () {
      return (yield* awaited(
        Promise.all(blocks.map((block) => blockToContent(server, block, options))),
      )).flat();
    }),
  );
}

const toModelContent: {
  (
    server: string,
    blocks: readonly mcpTypes.ContentBlock[],
    options?: toolsTypes.ConvertMcpResultOptions,
  ): Promise<(aiTypes.TextContent | aiTypes.ImageContent)[]>;
  (
    blocks: readonly mcpTypes.ContentBlock[],
    options?: toolsTypes.ConvertMcpResultOptions,
  ): (server: string) => Promise<(aiTypes.TextContent | aiTypes.ImageContent)[]>;
} = dual((args: IArguments) => args.length >= 2, toModelContentImpl);

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

const resultContent = { convertMcpResult, toModelContent };

export default resultContent;
