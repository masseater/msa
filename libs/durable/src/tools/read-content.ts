import type { Context } from "@msa/chord";
import { Effect } from "effect";

import type envTypes from "../env/index.types.ts";
import resultModule from "../env/result.ts";
import type typesModule from "../harness/types.types.ts";
import image from "./image.ts";
import type readContentTypes from "./read-content.types.ts";
import readImageModule from "./read-image.ts";
import readTextModule from "./read-text.ts";
import type readTextTypes from "./read-text.types.ts";

const { detectSupportedImageMimeTypeOf } = image;
const { binarySource, readText } = readTextModule;
const { imageModel, readImage } = readImageModule;
const { getOrThrow } = resultModule;

const attemptRead = Effect.fnUntraced(function* (
  source: readTextTypes.BinarySource,
  request: readContentTypes.ReadRequest,
  api: typesModule.ToolExecutionApi,
  context: Context,
) {
  const { path, offset, limit, images } = request;
  for (let attempt = 0; ; attempt++) {
    const before = yield* source.info;
    const mimeType = yield* detectSupportedImageMimeTypeOf({
      read: source.read,
      size: before.size,
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

const readContent = Effect.fnUntraced(function* (
  env: envTypes.ExecutionEnv,
  absolutePath: string,
  request: readContentTypes.ReadRequest,
  api: typesModule.ToolExecutionApi,
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

const readContentModule = {
  readContent,
};

export default readContentModule;
