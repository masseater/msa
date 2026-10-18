import type { Context } from "@msa/chord";
import { Effect } from "effect";

import type { FileInfo } from "../env/index.ts";
import type { ToolDiagnostic, ToolExecutionApi, ToolExecutionResult } from "../harness/types.ts";
import { formatSize } from "../truncate.ts";
import {
  base64Length,
  DEFAULT_IMAGE_LIMITS,
  imageDimensions,
  type ImageLimits,
  type ImageProcessor,
  INLINE_IMAGE_TYPES,
  toBase64,
} from "./image.ts";
import type { BinarySource, ReadToolDetails } from "./read-text.ts";

type ImageLoad =
  | {
      readonly image: { readonly data: string; readonly mimeType: string };
      readonly notes: string[];
    }
  | { readonly error: ToolExecutionResult<ReadToolDetails> };

type ImageModel = { readonly vision: boolean; readonly limits: ImageLimits };

const imageError = (message: string): ToolExecutionResult<ReadToolDetails> => ({
  output: [],
  isError: true,
  diagnostics: [{ severity: "error", code: "unsupported_image", message }],
});

const preparedImage = Effect.fnUntraced(function* (
  source: BinarySource,
  info: FileInfo,
  path: string,
  mimeType: string,
  processor: ImageProcessor,
  limits: ImageLimits,
) {
  const bytes = yield* source.read(0, info.size);
  const prepared = yield* Effect.promise(() => processor.prepare(bytes, mimeType, limits));
  if (prepared === undefined) {
    const failed: ImageLoad = {
      error: imageError(`${path} is an image (${mimeType}) that cannot be prepared for the model`),
    };
    return failed;
  }
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
  const loaded: ImageLoad = { image: prepared, notes };
  return loaded;
});

const inlineImage = Effect.fnUntraced(function* (
  source: BinarySource,
  info: FileInfo,
  path: string,
  mimeType: string,
  limits: ImageLimits,
) {
  const failed = (reason: string): ImageLoad => ({
    error: imageError(`${path} is an image (${mimeType})${reason}`),
  });
  if (!INLINE_IMAGE_TYPES.has(mimeType))
    return failed(" that needs converting, and no image processor is configured");
  const unshrinkable = "and no image processor is configured to shrink it";
  if (base64Length(info.size) > limits.maxBytes)
    return failed(` of ${formatSize(info.size)}, too large to send, ${unshrinkable}`);
  const bytes = yield* source.read(0, info.size);
  const size = imageDimensions(bytes, mimeType);
  if (size === undefined) return failed(" whose size cannot be read");
  if (size.width > limits.maxWidth || size.height > limits.maxHeight) {
    return failed(
      ` of ${size.width}x${size.height}, larger than ${limits.maxWidth}x${limits.maxHeight}, ${unshrinkable}`,
    );
  }
  const loaded: ImageLoad = { image: { data: toBase64(bytes), mimeType }, notes: [] };
  return loaded;
});

export const imageModel = Effect.fnUntraced(function* (api: ToolExecutionApi, context: Context) {
  const ref = (yield* Effect.promise(() => api.agent(context))).model;
  const model = ref === undefined ? undefined : api.models.getModel(ref.provider, ref.modelId);
  const resize = model?.inputLimits?.images?.resize;
  const found: ImageModel = {
    vision: model?.input.includes("image") ?? true,
    limits: {
      maxWidth: resize?.maxWidth ?? DEFAULT_IMAGE_LIMITS.maxWidth,
      maxHeight: resize?.maxHeight ?? DEFAULT_IMAGE_LIMITS.maxHeight,
      maxBytes: resize?.maxBytes ?? DEFAULT_IMAGE_LIMITS.maxBytes,
    },
  };
  return found;
});

export const readImage = Effect.fnUntraced(function* (
  source: BinarySource,
  info: FileInfo,
  path: string,
  mimeType: string,
  processor: ImageProcessor | undefined,
  { vision, limits }: ImageModel,
) {
  const loaded =
    processor === undefined
      ? yield* inlineImage(source, info, path, mimeType, limits)
      : yield* preparedImage(source, info, path, mimeType, processor, limits);
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
  const result: ToolExecutionResult<ReadToolDetails> = {
    output: [{ type: "image", data: image.data, mimeType: image.mimeType }],
    diagnostics,
  };
  return result;
});
