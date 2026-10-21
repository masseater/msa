import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import awaitingModule from "../../../core/awaiting.ts";
import truncate from "../../../core/tools/truncate.ts";
import errors from "../../../utils/errors.ts";
import outputFiles from "../../../utils/output-files.ts";
import type toolsTypes from "../tools.types.ts";

const { toErrorMessage } = errors;
const { awaited, awaiting } = awaitingModule;
const { truncateMiddle } = truncate;
const { writeOutputFile } = outputFiles;

const MCP_OUTPUT_MAX_BYTES = 20 * 1024;

function saveToTempFile(data: string | Uint8Array, extension: string): Promise<string> {
  return writeOutputFile("msa-mcp", extension, data);
}

function textOf(content: readonly (aiTypes.TextContent | aiTypes.ImageContent)[]): string {
  return content
    .filter((block): block is aiTypes.TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function limitMcpContentImpl(
  content: (aiTypes.TextContent | aiTypes.ImageContent)[],
  saveOutput: toolsTypes.McpOutputSaver = saveToTempFile,
): Promise<{ content: (aiTypes.TextContent | aiTypes.ImageContent)[]; fullOutputPath?: string }> {
  return Effect.runPromise(
    awaiting(function* () {
      const combined = textOf(content);
      const truncation = truncateMiddle(combined, MCP_OUTPUT_MAX_BYTES);
      if (!truncation.truncated) return { content };
      let fullOutputPath: string | undefined;
      let where: string;
      try {
        fullOutputPath = yield* awaited(saveOutput(combined, ".txt"));
        where = `[Full output: ${fullOutputPath} (read it with offset/limit)]`;
      } catch (error) {
        where = `[Could not save the full output: ${toErrorMessage(error)}]`;
      }
      const tokens = Math.ceil(truncation.totalBytes / 4);
      const text = `Warning: truncated output (original token count: ${tokens})\nTotal output lines: ${truncation.totalLines}\n\n${truncation.content}\n\n${where}`;
      return {
        content: [{ text, type: "text" }, ...content.filter((block) => block.type === "image")],
        ...(fullOutputPath !== undefined && fullOutputPath !== "" ? { fullOutputPath } : {}),
      };
    }),
  );
}

const limitMcpContent: {
  (
    content: (aiTypes.TextContent | aiTypes.ImageContent)[],
    saveOutput?: toolsTypes.McpOutputSaver,
  ): Promise<{ content: (aiTypes.TextContent | aiTypes.ImageContent)[]; fullOutputPath?: string }>;
  (saveOutput?: toolsTypes.McpOutputSaver): (
    content: (aiTypes.TextContent | aiTypes.ImageContent)[],
  ) => Promise<{
    content: (aiTypes.TextContent | aiTypes.ImageContent)[];
    fullOutputPath?: string;
  }>;
} = dual((args: IArguments) => args.length >= 1, limitMcpContentImpl);

const outputLimit = { MCP_OUTPUT_MAX_BYTES, limitMcpContent, saveToTempFile, textOf };

export default outputLimit;
