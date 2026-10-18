import type { Context } from "@msa/chord";
import { Effect } from "effect";

import type { ExecutionEnv } from "../env/index.ts";
import { getOrThrow } from "../env/result.ts";
import type { ToolExecutionApi } from "../harness/types.ts";
import { detectSupportedImageMimeTypeOf, type ImageProcessor } from "./image.ts";
import { imageModel, readImage } from "./read-image.ts";
import { type BinarySource, binarySource, readText } from "./read-text.ts";

export type ReadRequest = {
  readonly path: string;
  readonly offset: number | undefined;
  readonly limit: number | undefined;
  readonly images: ImageProcessor | undefined;
};

const attemptRead = Effect.fnUntraced(function* (
  source: BinarySource,
  request: ReadRequest,
  api: ToolExecutionApi,
  context: Context,
) {
  const { path, offset, limit, images } = request;
  for (let attempt = 0; ; attempt++) {
    const before = yield* source.info;
    const mimeType = yield* detectSupportedImageMimeTypeOf({
      size: before.size,
      read: source.read,
    });
    const result =
      mimeType === undefined
        ? yield* readText(source, path, offset, limit)
        : yield* readImage(source, before, path, mimeType, images, yield* imageModel(api, context));
    const after = yield* source.info;
    const unchanged = after.size === before.size && after.mtimeMs === before.mtimeMs;
    if (unchanged || (mimeType === undefined && after.size > before.size)) return result;
    if (attempt === 1) throw new Error(`${path} changed while it was read`);
  }
});

export const readContent = Effect.fnUntraced(function* (
  env: ExecutionEnv,
  absolutePath: string,
  request: ReadRequest,
  api: ToolExecutionApi,
  context: Context,
) {
  const reader = getOrThrow(
    yield* Effect.promise(() => env.openBinaryReader(absolutePath, undefined, context)),
  );
  const source = binarySource(reader, context);
  const exit = yield* Effect.exit(attemptRead(source, request, api, context));
  yield* source.close;
  return yield* exit;
});
