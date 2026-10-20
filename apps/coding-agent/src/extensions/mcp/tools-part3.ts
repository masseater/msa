import type aiTypes from "@msa/ai/index.types";
import mcp from "@msa/mcp";
import type mcpTypes from "@msa/mcp/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import mcpServers from "../../core/mcp-servers.ts";
import truncate from "../../core/tools/truncate.ts";
import errors from "../../utils/errors.ts";
import toolsPart1 from "./tools-part1.ts";
import toolsPart2 from "./tools-part2.ts";
import type toolsTypes from "./tools.types.ts";

const { awaited, awaiting } = awaitingModule;
const { formatSize } = truncate;
const { READ_MCP_RESOURCE_TOOL } = mcpServers;
const { toErrorMessage } = errors;
const { toLlmContent } = mcp;
const { extensionOf, isTextMimeType } = toolsPart2;
const { saveToTempFile } = toolsPart1;

function blockToContent(
  server: string,
  block: mcpTypes.ContentBlock,
  options: toolsTypes.ConvertMcpResultOptions,
): Promise<(aiTypes.TextContent | aiTypes.ImageContent)[]> {
  return Effect.runPromise(
    awaiting(function* () {
      if (block.type === "resource_link") {
        const details = [
          block.mimeType,
          block.size === undefined ? undefined : formatSize(block.size),
        ].filter(Boolean);
        const read =
          options.readableResources === true
            ? `. Read it with ${READ_MCP_RESOURCE_TOOL} (server "${server}")`
            : "";
        const description =
          block.description !== undefined && block.description !== ""
            ? `: ${block.description}`
            : "";
        return [
          {
            text: `[Resource ${block.uri} "${block.title ?? block.name}"${details.length > 0 ? ` (${details.join(", ")})` : ""}${description}${read}]`,
            type: "text",
          },
        ];
      }
      if (
        block.type === "resource" &&
        "blob" in block.resource &&
        block.resource.mimeType?.startsWith("image/") !== true
      ) {
        const { uri, mimeType, blob } = block.resource;
        const data = Buffer.from(blob, "base64");
        if (isTextMimeType(mimeType)) return [{ text: data.toString("utf8"), type: "text" }];
        const kind = `${mimeType ?? "unknown type"}, ${formatSize(data.length)}`;
        try {
          const path = yield* awaited(
            (options.saveOutput ?? saveToTempFile)(data, extensionOf(uri)),
          );
          return [{ text: `[Binary resource ${uri} (${kind}) saved to ${path}]`, type: "text" }];
        } catch (error) {
          const reason = toErrorMessage(error);
          return [
            {
              text: `[Binary resource ${uri} (${kind}) could not be saved: ${reason}]`,
              type: "text",
            },
          ];
        }
      }
      return toLlmContent({ content: [block] });
    }),
  );
}

const toolsPart3 = {
  blockToContent,
};

export default toolsPart3;
