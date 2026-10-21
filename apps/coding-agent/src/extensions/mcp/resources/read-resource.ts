import type aiTypes from "@msa/ai/index.types";
import type mcpTypes from "@msa/mcp/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../../../core/awaiting.ts";
import mcpServers from "../../../core/mcp-servers.ts";
import type resourcesTypes from "../resources.types.ts";
import tools from "../tools.ts";
import resourceListing from "./resource-listing.ts";

const { awaited, awaiting } = awaitingModule;
const { READ_MCP_RESOURCE_TOOL } = mcpServers;
const { limitMcpContent, toModelContent } = tools;
const { findServer, requestOptions, stringArgument } = resourceListing;

function readResource(
  servers: () => readonly resourcesTypes.McpResourceServer[],
  params: unknown,
  signal: AbortSignal | undefined,
) {
  return Effect.runPromise(
    awaiting(function* () {
      const serverName = stringArgument(params, "server");
      const uri = stringArgument(params, "uri");
      if (serverName === undefined || serverName === "") throw new Error("server must be provided");
      if (uri === undefined || uri === "") throw new Error("uri must be provided");
      const server = findServer(servers, serverName);
      const result = yield* awaited(server.readResource(uri, requestOptions(server, signal)));

      const blocks: mcpTypes.ContentBlock[] = result.contents.flatMap((contents) => [
        ...(result.contents.length > 1
          ? [{ text: `${contents.uri}:`, type: "text" as const }]
          : []),
        { resource: contents, type: "resource" as const },
      ]);
      const converted = yield* awaited(toModelContent(server.name, blocks));
      const { content, fullOutputPath } = yield* awaited(
        limitMcpContent(
          converted.length > 0 ? converted : [{ text: `Resource ${uri} is empty.`, type: "text" }],
        ),
      );
      const contents = result.contents.map(({ _meta: _ignored, ...rest }) => rest);
      return {
        content,
        details: {
          server: server.name,
          tool: READ_MCP_RESOURCE_TOOL,
          ...(fullOutputPath !== undefined && fullOutputPath !== "" ? { fullOutputPath } : {}),
        },
        structuredContent: { contents, server: server.name, uri } as unknown as aiTypes.JsonValue,
      };
    }),
  );
}

const readResourceModule = { readResource };

export default readResourceModule;
