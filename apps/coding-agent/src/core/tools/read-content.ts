import type aiTypes from "@msa/ai/index.types";
import { Effect } from "effect";
import { Type } from "typebox";

import imageProcess from "../../utils/image-process.ts";
import platform from "../platform/index.ts";
import type readContentTypes from "./read-content.types.ts";
import truncate from "./truncate.ts";
import type truncateTypes from "./truncate.types.ts";

const { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } = truncate;
const { ToolFailure, fromPromise } = platform;
const { processImage } = imageProcess;

const readToolSystemPromptContribution = {
  guidelines: ["Use read to examine files instead of cat or sed."],
  snippet: "Read file contents",
} as const;

const readSchema = Type.Object({
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
  offset: Type.Optional(
    Type.Number({ description: "Line number to start reading from (1-indexed)" }),
  ),
  path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
});

const readOutputSchema = Type.Union([
  Type.String(),
  Type.Object({
    data: Type.String(),
    mimeType: Type.String(),
    note: Type.String(),
    type: Type.Literal("image"),
  }),
]);

function toReadOutput(
  content: (aiTypes.TextContent | aiTypes.ImageContent)[],
): readContentTypes.ReadToolOutput {
  const text = content.find((block) => block.type === "text")?.text ?? "";
  const image = content.find((block) => block.type === "image");
  return image === undefined
    ? text
    : { data: image.data, mimeType: image.mimeType, note: text, type: "image" };
}

function getNonVisionImageNote(model: aiTypes.Model<aiTypes.Api> | undefined): string | undefined {
  if (model === undefined || model.input.includes("image")) {
    return undefined;
  }
  return "[Current model does not support images. The image will be omitted from this request.]";
}

const readDescription = `Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`;

const readImageContent = Effect.fn("readImageContent")(function* (
  input: readContentTypes.ImageReadInput,
) {
  const buffer = yield* fromPromise(() => input.ops.readFile(input.absolutePath));
  const processed = yield* fromPromise(() =>
    processImage(buffer, input.mimeType, {
      autoResizeImages: input.autoResizeImages,
      resizeOptions: input.resizeOptions,
    }),
  );
  const note = getNonVisionImageNote(input.model);
  const noteSuffix = note === undefined || note === "" ? "" : `\n${note}`;
  if (!processed.ok) {
    const text = `Read image file [${input.mimeType}]\n${processed.message}${noteSuffix}`;
    return [{ text, type: "text" as const }];
  }
  const hints = processed.hints.length > 0 ? `\n${processed.hints.join("\n")}` : "";
  return [
    { text: `Read image file [${processed.mimeType}]${hints}${noteSuffix}`, type: "text" as const },
    { data: processed.data, mimeType: processed.mimeType, type: "image" as const },
  ];
});

const continuationNotice = (
  truncation: truncateTypes.TruncationResult,
  lines: { start: number; end: number; total: number },
): string => {
  const limit =
    truncation.truncatedBy === "lines" ? "" : ` (${formatSize(DEFAULT_MAX_BYTES)} limit)`;
  return `\n\n[Showing lines ${lines.start}-${lines.end} of ${lines.total}${limit}. Use offset=${lines.end + 1} to continue.]`;
};

const readTextContent = Effect.fn("readTextContent")(function* (
  input: readContentTypes.TextReadInput,
) {
  const allLines = input.buffer.toString("utf-8").split("\n");
  const startLine =
    input.offset !== undefined && input.offset !== 0 ? Math.max(0, input.offset - 1) : 0;
  const startLineDisplay = startLine + 1;
  const firstLine = allLines[startLine];
  if (firstLine === undefined) {
    return yield* new ToolFailure({
      message: `Offset ${input.offset} is beyond end of file (${allLines.length} lines total)`,
    });
  }
  const endLine =
    input.limit === undefined
      ? allLines.length
      : Math.min(startLine + input.limit, allLines.length);
  const truncation = truncateHead(allLines.slice(startLine, endLine).join("\n"));
  const content = (text: string) => [{ text, type: "text" as const }];
  if (truncation.firstLineExceedsLimit) {
    const firstLineSize = formatSize(Buffer.byteLength(firstLine, "utf-8"));
    const text = `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${startLineDisplay}p' ${input.path} | head -c ${DEFAULT_MAX_BYTES}]`;
    return { content: content(text), details: { truncation } };
  }
  if (truncation.truncated) {
    const lines = {
      end: startLineDisplay + truncation.outputLines - 1,
      start: startLineDisplay,
      total: allLines.length,
    };
    return {
      content: content(truncation.content + continuationNotice(truncation, lines)),
      details: { truncation },
    };
  }
  if (input.limit !== undefined && endLine < allLines.length) {
    const remaining = allLines.length - endLine;
    const text = `${truncation.content}\n\n[${remaining} more lines in file. Use offset=${endLine + 1} to continue.]`;
    return { content: content(text), details: undefined };
  }
  return { content: content(truncation.content), details: undefined };
});

const readContent = {
  readDescription,
  readImageContent,
  readOutputSchema,
  readSchema,
  readTextContent,
  readToolSystemPromptContribution,
  toReadOutput,
};

export default readContent;
