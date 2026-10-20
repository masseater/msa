import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import awaitingModule from "../../core/awaiting.ts";
import truncate from "../../core/tools/truncate.ts";
import errors from "../../utils/errors.ts";
import toolsPart1 from "./tools-part1.ts";
import type toolsTypes from "./tools.types.ts";

const { awaited, awaiting } = awaitingModule;
const { truncateMiddle } = truncate;
const { toErrorMessage } = errors;
const { MCP_OUTPUT_MAX_BYTES, saveToTempFile, textOf } = toolsPart1;

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

const toolsPart2 = {
  extensionOf,
  isTextMimeType,
  limitMcpContent,
};

export default toolsPart2;
