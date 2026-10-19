import type { Api, ImageContent, Model, ModelImageResizeOptions, TextContent } from "@msa/ai";
import { Effect } from "effect";
import { type Static, Type } from "typebox";

import { processImage } from "../../utils/image-process.ts";
import { fromPromise, ToolFailure } from "../platform/index.ts";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type TruncationResult,
  truncateHead,
} from "./truncate.ts";

export const readToolSystemPromptContribution = {
  snippet: "Read file contents",
  guidelines: ["Use read to examine files instead of cat or sed."],
} as const;

export const readSchema = Type.Object({
  path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
  offset: Type.Optional(
    Type.Number({ description: "Line number to start reading from (1-indexed)" }),
  ),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

export type ReadToolInput = Static<typeof readSchema>;

export const readOutputSchema = Type.Union([
  Type.String(),
  Type.Object({
    type: Type.Literal("image"),
    data: Type.String(),
    mimeType: Type.String(),
    note: Type.String(),
  }),
]);

export type ReadToolOutput = Static<typeof readOutputSchema>;

export interface ReadToolDetails {
  truncation?: TruncationResult;
}

export interface ReadOperations {
  readFile: (absolutePath: string) => Promise<Buffer>;
  access: (absolutePath: string) => Promise<void>;
  detectImageMimeType?: (absolutePath: string) => Promise<string | null | undefined>;
}

export function toReadOutput(content: (TextContent | ImageContent)[]): ReadToolOutput {
  const text = content.find((block) => block.type === "text")?.text ?? "";
  const image = content.find((block) => block.type === "image");
  return image === undefined
    ? text
    : { type: "image", data: image.data, mimeType: image.mimeType, note: text };
}

function getNonVisionImageNote(model: Model<Api> | undefined): string | undefined {
  if (model === undefined || model.input.includes("image")) {
    return undefined;
  }
  return "[Current model does not support images. The image will be omitted from this request.]";
}

export interface ReadToolOptions {
  autoResizeImages?: boolean;
  resizeOptions?: ModelImageResizeOptions;
  operations?: ReadOperations;
}

export const readDescription = `Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`;

export interface ImageReadInput {
  ops: ReadOperations;
  absolutePath: string;
  mimeType: string;
  autoResizeImages: boolean;
  resizeOptions: ModelImageResizeOptions | undefined;
  model: Model<Api> | undefined;
}

export const readImageContent = Effect.fn("readImageContent")(function* (input: ImageReadInput) {
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
    return [{ type: "text" as const, text }];
  }
  const hints = processed.hints.length > 0 ? `\n${processed.hints.join("\n")}` : "";
  return [
    { type: "text" as const, text: `Read image file [${processed.mimeType}]${hints}${noteSuffix}` },
    { type: "image" as const, data: processed.data, mimeType: processed.mimeType },
  ];
});

export interface TextReadInput {
  buffer: Buffer;
  path: string;
  offset: number | undefined;
  limit: number | undefined;
}

const continuationNotice = (
  truncation: TruncationResult,
  lines: { start: number; end: number; total: number },
): string => {
  const limit =
    truncation.truncatedBy === "lines" ? "" : ` (${formatSize(DEFAULT_MAX_BYTES)} limit)`;
  return `\n\n[Showing lines ${lines.start}-${lines.end} of ${lines.total}${limit}. Use offset=${lines.end + 1} to continue.]`;
};

export const readTextContent = Effect.fn("readTextContent")(function* (input: TextReadInput) {
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
  const content = (text: string) => [{ type: "text" as const, text }];
  if (truncation.firstLineExceedsLimit) {
    const firstLineSize = formatSize(Buffer.byteLength(firstLine, "utf-8"));
    const text = `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${startLineDisplay}p' ${input.path} | head -c ${DEFAULT_MAX_BYTES}]`;
    return { content: content(text), details: { truncation } };
  }
  if (truncation.truncated) {
    const lines = {
      start: startLineDisplay,
      end: startLineDisplay + truncation.outputLines - 1,
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
