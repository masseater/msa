import type { Context } from "@msa/chord";
import { characterEnd } from "@msa/chord/output";
import { type Static, Type } from "typebox";

import {
  type BinaryReader,
  type FileInfo,
  getOrThrow,
  type LineScan,
  rangeDecoder,
  startsWithBom,
} from "../env/index.ts";
import { defineTool } from "../harness/define.ts";
import type {
  ToolDiagnostic,
  ToolExecutionApi,
  ToolExecutionResult,
  ToolRegistration,
} from "../harness/types.ts";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type TruncationResult,
  truncateHeadOf,
  utf8ByteLength,
} from "../truncate.ts";
import { requireEnv } from "./env.ts";
import {
  base64Length,
  DEFAULT_IMAGE_LIMITS,
  type ImageLimits,
  type ImageProcessor,
  INLINE_IMAGE_TYPES,
  toBase64,
} from "./image-processor.ts";
import { detectSupportedImageMimeTypeOf, imageDimensions } from "./image.ts";
import { resolveReadToolPath } from "./path-utils.ts";

const readSchema = Type.Object({
  path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
  offset: Type.Optional(
    Type.Number({ description: "Line number to start reading from (1-indexed)" }),
  ),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

export type ReadToolInput = Static<typeof readSchema>;

export type ReadToolDetails = {
  truncation?: Omit<TruncationResult, "content">;
};

const READ_CHUNK = 64 * 1024;

function sliceIndex(value: number): number {
  return Number.isNaN(value) ? 0 : Math.trunc(value);
}

function readHead(
  reader: BinaryReader,
  start: number,
  end: number,
  skipBom: boolean,
  context: Context,
): Promise<string> {
  const decoder = rangeDecoder();
  let text = "";
  let newlines = 0;
  const readFrom = async (position: number): Promise<string> => {
    if (position >= end) return text + decoder.decode();
    const bytes = getOrThrow(
      await reader.read(position, Math.min(READ_CHUNK, end - position), context),
    );
    if (bytes.length === 0) return text + decoder.decode();
    const decoded = decoder.decode(bytes, { stream: true });
    text += decoded;
    for (let index = decoded.indexOf("\n"); index !== -1; index = decoded.indexOf("\n", index + 1))
      newlines++;
    if (newlines >= DEFAULT_MAX_LINES || utf8ByteLength(text) > DEFAULT_MAX_BYTES + 1) return text;
    return readFrom(position + bytes.length);
  };
  return readFrom(skipBom && start === 0 ? 3 : start);
}

export type ReadToolOptions = {
  readonly images?: ImageProcessor;
};

export function createReadTool(
  options: ReadToolOptions = {},
): ToolRegistration<typeof readSchema, ReadToolDetails> {
  const formats = options.images === undefined ? "jpg, png, gif, webp" : "jpg, png, gif, webp, bmp";
  return defineTool({
    name: "read",
    description: `Read the contents of a file. Supports text files and images (${formats}). Images are sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
    parameters: readSchema,
    async execute(args, api, context) {
      const { path, offset, limit } = args;
      const env = requireEnv(api);
      const absolutePath = await resolveReadToolPath(env, path, context);
      const reader = getOrThrow(await env.openBinaryReader(absolutePath, undefined, context));
      try {
        const attemptRead = async (
          attempt: number,
        ): Promise<ToolExecutionResult<ReadToolDetails>> => {
          const before = getOrThrow(await reader.info(context));
          const mimeType = await detectSupportedImageMimeTypeOf({
            size: before.size,
            read: async (position, length) =>
              getOrThrow(await reader.read(position, length, context)),
          });
          const result =
            mimeType === undefined
              ? await readText(reader, path, offset, limit, context)
              : await readImage(
                  reader,
                  before,
                  path,
                  mimeType,
                  options.images,
                  await imageModel(api, context),
                  context,
                );
          const after = getOrThrow(await reader.info(context));
          const unchanged = after.size === before.size && after.mtimeMs === before.mtimeMs;
          if (unchanged || (mimeType === undefined && after.size > before.size)) return result;
          if (attempt === 1) throw new Error(`${path} changed while it was read`);
          return attemptRead(attempt + 1);
        };
        return await attemptRead(0);
      } finally {
        await reader.close(context);
      }
    },
  });
}

async function readImage(
  reader: BinaryReader,
  info: FileInfo,
  path: string,
  mimeType: string,
  processor: ImageProcessor | undefined,
  { vision, limits }: ImageModel,
  context: Context,
): Promise<ToolExecutionResult<ReadToolDetails>> {
  const loaded =
    processor === undefined
      ? await inlineImage(reader, info, path, mimeType, limits, context)
      : await preparedImage(reader, info, path, mimeType, processor, limits, context);
  if ("error" in loaded) return loaded.error;
  const { image, notes } = loaded;
  if (!vision)
    notes.push("The current model does not support images; it sees a placeholder instead.");
  const diagnostics: ToolDiagnostic[] = [
    {
      severity: "info",
      code: "image",
      message: [`Read image file [${image.mimeType}].`, ...notes].join(" "),
    },
  ];
  return { output: [{ type: "image", data: image.data, mimeType: image.mimeType }], diagnostics };
}

type ImageLoad =
  | {
      readonly image: { readonly data: string; readonly mimeType: string };
      readonly notes: string[];
    }
  | { readonly error: ToolExecutionResult<ReadToolDetails> };

async function preparedImage(
  reader: BinaryReader,
  info: FileInfo,
  path: string,
  mimeType: string,
  processor: ImageProcessor,
  limits: ImageLimits,
  context: Context,
): Promise<ImageLoad> {
  const bytes = getOrThrow(await reader.read(0, info.size, context));
  const prepared = await processor.prepare(bytes, mimeType, limits);
  if (prepared === undefined)
    return {
      error: imageError(`${path} is an image (${mimeType}) that cannot be prepared for the model`),
    };
  const notes: string[] = [];
  if (prepared.convertedFrom !== undefined)
    notes.push(`Converted from ${prepared.convertedFrom} to ${prepared.mimeType}.`);
  if (prepared.resized !== undefined) {
    const { from, to } = prepared.resized;
    const scale = (from.width / to.width).toFixed(2);
    notes.push(
      `Resized from ${from.width}x${from.height} to ${to.width}x${to.height}. Multiply coordinates by ${scale} to map them to the original.`,
    );
  }
  return { image: prepared, notes };
}

async function inlineImage(
  reader: BinaryReader,
  info: FileInfo,
  path: string,
  mimeType: string,
  limits: ImageLimits,
  context: Context,
): Promise<ImageLoad> {
  if (!INLINE_IMAGE_TYPES.has(mimeType)) {
    return {
      error: imageError(
        `${path} is an image (${mimeType}) that needs converting, and no image processor is configured`,
      ),
    };
  }
  const unshrinkable = "and no image processor is configured to shrink it";
  if (base64Length(info.size) > limits.maxBytes) {
    return {
      error: imageError(
        `${path} is an image (${mimeType}) of ${formatSize(info.size)}, too large to send, ${unshrinkable}`,
      ),
    };
  }
  const bytes = getOrThrow(await reader.read(0, info.size, context));
  const size = imageDimensions(bytes, mimeType);
  if (size === undefined)
    return { error: imageError(`${path} is an image (${mimeType}) whose size cannot be read`) };
  if (size.width > limits.maxWidth || size.height > limits.maxHeight) {
    return {
      error: imageError(
        `${path} is an image (${mimeType}) of ${size.width}x${size.height}, larger than ${limits.maxWidth}x${limits.maxHeight}, ${unshrinkable}`,
      ),
    };
  }
  return { image: { data: toBase64(bytes), mimeType }, notes: [] };
}

type ImageModel = { readonly vision: boolean; readonly limits: ImageLimits };

async function imageModel(api: ToolExecutionApi, context: Context): Promise<ImageModel> {
  const ref = (await api.agent(context)).model;
  const model = ref === undefined ? undefined : api.models.getModel(ref.provider, ref.modelId);
  const resize = model?.inputLimits?.images?.resize;
  return {
    vision: model?.input.includes("image") ?? true,
    limits: {
      maxWidth: resize?.maxWidth ?? DEFAULT_IMAGE_LIMITS.maxWidth,
      maxHeight: resize?.maxHeight ?? DEFAULT_IMAGE_LIMITS.maxHeight,
      maxBytes: resize?.maxBytes ?? DEFAULT_IMAGE_LIMITS.maxBytes,
    },
  };
}

function imageError(message: string): ToolExecutionResult<ReadToolDetails> {
  return {
    output: [],
    isError: true,
    diagnostics: [{ severity: "error", code: "unsupported_image", message }],
  };
}

async function readText(
  reader: BinaryReader,
  path: string,
  offset: number | undefined,
  limit: number | undefined,
  context: Context,
) {
  const startLine = offset ? Math.max(0, offset - 1) : 0;
  const startLineDisplay = startLine + 1;
  const sliceStart = sliceIndex(startLine);
  const scanStart = Number.isSafeInteger(sliceStart) ? sliceStart : 0;
  const requestedEnd =
    limit === undefined ? undefined : Math.max(scanStart + 1, sliceIndex(startLine + limit));
  const scanEnd =
    requestedEnd !== undefined && Number.isSafeInteger(requestedEnd) ? requestedEnd : undefined;
  const scanOf = async (endLine: number | undefined): Promise<LineScan> =>
    getOrThrow(
      await reader.scanLines(
        { startLine: scanStart, ...(endLine === undefined ? {} : { endLine }) },
        context,
      ),
    );
  let scan = await scanOf(scanEnd);
  const totalFileLines = scan.newlines + 1;
  if (startLine >= totalFileLines) {
    throw new Error(`Offset ${offset} is beyond end of file (${totalFileLines} lines total)`);
  }

  let userLimitedLines: number | undefined;
  let selectedLineCount = totalFileLines - sliceStart;
  if (limit !== undefined) {
    const endLine = Math.min(startLine + limit, totalFileLines);
    userLimitedLines = endLine - startLine;
    const relativeEnd = sliceIndex(endLine);
    const sliceEnd = relativeEnd < 0 ? Math.max(totalFileLines + relativeEnd, 0) : relativeEnd;
    selectedLineCount = Math.max(0, sliceEnd - sliceStart);
    if (selectedLineCount > 0 && relativeEnd < 0) scan = await scanOf(sliceEnd);
  }
  const empty = selectedLineCount === 0;
  const endsWithNewline =
    !empty && scan.lastLineStart === scan.end && scan.lastLineStart > scan.start;
  const totals = {
    lines: empty || scan.selectedBytes === 0 ? 0 : selectedLineCount - (endsWithNewline ? 1 : 0),
    bytes: empty ? 0 : scan.selectedBytes,
  };
  const firstBytes = getOrThrow(await reader.read(0, 3, context));
  const head = empty
    ? ""
    : await readHead(reader, scan.start, scan.end, startsWithBom(firstBytes), context);

  const { content: headText, ...truncation } = truncateHeadOf(head, totals);
  const diagnostics: ToolDiagnostic[] = [];
  let outputText = headText;
  let details: ReadToolDetails | undefined;
  if (truncation.firstLineExceedsLimit) {
    const integral = Number.isInteger(startLine);
    const lineBytes = new TextEncoder().encode(integral ? (head.split("\n")[0] ?? "") : "");
    const lineSize = integral ? scan.firstLineBytes : 0;
    const end = characterEnd(lineBytes, DEFAULT_MAX_BYTES);
    outputText = new TextDecoder().decode(lineBytes.subarray(0, end));
    diagnostics.push({
      severity: "warn",
      code: "truncated",
      message: `Line ${startLineDisplay} is ${formatSize(lineSize)}, exceeds the ${formatSize(DEFAULT_MAX_BYTES)} limit; showing its first ${formatSize(end)}. Use bash: sed -n '${startLineDisplay}p' ${path} | tail -c +${end + 1}`,
    });
    details = { truncation: { ...truncation, outputBytes: end, outputLines: 1 } };
  } else if (truncation.truncated) {
    const endLineDisplay = startLineDisplay + truncation.outputLines - 1;
    const nextOffset = endLineDisplay + 1;
    const limitText =
      truncation.truncatedBy === "lines" ? "" : ` (${formatSize(DEFAULT_MAX_BYTES)} limit)`;
    diagnostics.push({
      severity: "info",
      code: "truncated",
      message: `Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}${limitText}. Use offset=${nextOffset} to continue.`,
    });
    details = { truncation };
  } else if (userLimitedLines !== undefined && startLine + userLimitedLines < totalFileLines) {
    const remaining = totalFileLines - (startLine + userLimitedLines);
    const nextOffset = startLine + userLimitedLines + 1;
    diagnostics.push({
      severity: "info",
      message: `${remaining} more lines in file. Use offset=${nextOffset} to continue.`,
    });
  }

  return {
    output: outputText === "" ? [] : [{ type: "text" as const, text: outputText }],
    ...(details === undefined ? {} : { details }),
    diagnostics,
  };
}
