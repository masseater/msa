import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, ManagedRuntime } from "effect";

import mime from "../../utils/mime.ts";
import platform from "../platform/index.ts";
import pathUtils from "./path-utils.ts";
import readContent from "./read-content.ts";
import type readTypes from "./read.types.ts";

const nodeRuntime = ManagedRuntime.make(NodeServices.layer);

const { readImageContent, readTextContent, toReadOutput } = readContent;
const { abortedBy, fromPromise, nonEmptyOr, rethrowCause, unwrapForeign } = platform;
const { detectSupportedImageMimeTypeFromFile } = mime;
const { resolveReadPathAsync } = pathUtils;

const defaultReadOperations: readTypes.ReadOperations = {
  access: (path) =>
    nodeRuntime.runPromise(
      rethrowCause(FileSystem.FileSystem.use((fs) => fs.access(path, { readable: true }))),
    ),
  detectImageMimeType: detectSupportedImageMimeTypeFromFile,
  readFile: (path) =>
    nodeRuntime.runPromise(
      rethrowCause(
        FileSystem.FileSystem.use((fs) => fs.readFile(path)).pipe(
          Effect.map((bytes) => Buffer.from(bytes)),
        ),
      ),
    ),
};

interface ReadRequest {
  ops: readTypes.ReadOperations;
  options: readTypes.ReadToolOptions | undefined;
  cwd: string;
  path: string;
  offset: number | undefined;
  limit: number | undefined;
  ctx: readTypes.ReadToolContext | undefined;
  signal: AbortSignal | undefined;
}

const readFileTool = Effect.fn("read")(function* (request: ReadRequest) {
  const { ops, options, ctx } = request;
  const absolutePath = yield* fromPromise(() =>
    resolveReadPathAsync(request.path, nonEmptyOr(ctx?.cwd, request.cwd)),
  );
  yield* fromPromise(() => ops.access(absolutePath));
  const mimeType = yield* fromPromise(() => ops.detectImageMimeType?.(absolutePath));
  if (mimeType !== undefined && mimeType !== null && mimeType !== "") {
    const content = yield* readImageContent({
      absolutePath,
      autoResizeImages: options?.autoResizeImages ?? true,
      mimeType,
      model: ctx?.model,
      ops,
      resizeOptions: ctx?.model?.inputLimits?.images?.resize ?? options?.resizeOptions,
    });
    return { content, details: undefined as readTypes.ReadToolDetails | undefined };
  }
  const buffer = yield* fromPromise(() => ops.readFile(absolutePath));
  return yield* readTextContent({
    buffer,
    limit: request.limit,
    offset: request.offset,
    path: request.path,
  });
});

const readFile = (request: ReadRequest) =>
  nodeRuntime.runPromise(
    unwrapForeign(
      readFileTool(request).pipe(
        abortedBy(request.signal),
        Effect.map((result) => ({
          content: result.content,
          details: result.details,
          structuredContent: toReadOutput(result.content),
        })),
      ),
    ),
  );

const readFileModule = { defaultReadOperations, readFile };

export default readFileModule;
