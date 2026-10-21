import type mcpTypes from "@msa/mcp/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../../../core/awaiting.ts";
import mcpServers from "../../../core/mcp-servers.ts";
import truncate from "../../../core/tools/truncate.ts";
import errors from "../../../utils/errors.ts";
import type toolsTypes from "../tools.types.ts";
import outputLimit from "./output-limit.ts";

const { toErrorMessage } = errors;
const { awaited, awaiting } = awaitingModule;
const { READ_MCP_RESOURCE_TOOL } = mcpServers;
const { formatSize } = truncate;
const { saveToTempFile } = outputLimit;

function extensionOf(uri: string): string {
  const path = URL.canParse(uri) ? new URL(uri).pathname : uri;
  return /\.[A-Za-z0-9]{1,8}$/u.exec(path)?.[0] ?? ".bin";
}

function isTextMimeType(mimeType: string | undefined): boolean {
  if (mimeType === undefined || mimeType === "") return false;
  const type = (mimeType.split(";", 1)[0] ?? "").trim().toLowerCase();
  return (
    type.startsWith("text/") ||
    type === "application/json" ||
    type.endsWith("+json") ||
    type.endsWith("+xml")
  );
}

function describeResourceLink(
  server: string,
  block: Extract<mcpTypes.ContentBlock, { type: "resource_link" }>,
  options: toolsTypes.ConvertMcpResultOptions,
): string {
  const details = [
    block.mimeType,
    block.size === undefined ? undefined : formatSize(block.size),
  ].filter(Boolean);
  const read =
    options.readableResources === true
      ? `. Read it with ${READ_MCP_RESOURCE_TOOL} (server "${server}")`
      : "";
  const description =
    block.description !== undefined && block.description !== "" ? `: ${block.description}` : "";
  return `[Resource ${block.uri} "${block.title ?? block.name}"${details.length > 0 ? ` (${details.join(", ")})` : ""}${description}${read}]`;
}

function describeBinaryResource(
  resource: { uri: string; mimeType?: string | undefined; blob: string },
  options: toolsTypes.ConvertMcpResultOptions,
): Promise<string> {
  return Effect.runPromise(
    awaiting(function* () {
      const { uri, mimeType, blob } = resource;
      const data = Buffer.from(blob, "base64");
      if (isTextMimeType(mimeType)) return data.toString("utf8");
      const kind = `${mimeType ?? "unknown type"}, ${formatSize(data.length)}`;
      try {
        const path = yield* awaited((options.saveOutput ?? saveToTempFile)(data, extensionOf(uri)));
        return `[Binary resource ${uri} (${kind}) saved to ${path}]`;
      } catch (error) {
        return `[Binary resource ${uri} (${kind}) could not be saved: ${toErrorMessage(error)}]`;
      }
    }),
  );
}

const resourceBlocks = { describeBinaryResource, describeResourceLink };

export default resourceBlocks;
