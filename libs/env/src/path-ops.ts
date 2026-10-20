import { type FileError, type FileListing, type Result, err, ok } from "@msa/durable/env";
import { Cause, Effect } from "effect";

import errors from "./errors.ts";
import fileOp from "./file-op.ts";
import type fileOpTypes from "./file-op.types.ts";
import listFilesModule from "./list-files.ts";
import type pathOpsTypes from "./path-ops.types.ts";
import platform from "./platform.ts";
import remotePathModule from "./remote-path.ts";

const { remoteRequest, resolveIn, run, runFileOp } = fileOp;
const { abortResult, fileResult, toFileError } = errors;
const { remotePath } = remotePathModule;
const { listFilesOver } = listFilesModule;
const { randomUuid } = platform;

const absolutePathOf = (request: {
  target: fileOpTypes.RemoteTarget;
  path: string;
}): Promise<Result<string, FileError>> => run(fileResult(resolveIn(request), request.path));

const joinPathIn = (request: {
  target: fileOpTypes.RemoteTarget;
  parts: string[];
}): Promise<Result<string, FileError>> =>
  run(
    fileResult(
      remotePath(request.target.connection).pipe(
        Effect.map((paths) => paths.join(...request.parts)),
      ),
      undefined,
    ),
  );

const canonicalPathOf = (request: fileOpTypes.PathRequest): Promise<Result<string, FileError>> => {
  const { connection } = request.target;
  return run(
    runFileOp({
      ...request,
      operation: (resolved) =>
        remoteRequest({ connection, json: { path: resolved }, op: "realpath" }).pipe(
          Effect.map((json) => json["path"] as string),
        ),
    }),
  );
};

const listFilesAt = (
  request: pathOpsTypes.ListFilesRequest,
): Promise<Result<FileListing, FileError>> =>
  run(
    Effect.gen(function* () {
      const resolved = yield* fileResult(resolveIn(request), request.path);
      if (!resolved.ok) return resolved;
      return yield* Effect.promise(() =>
        listFilesOver(request.target.connection, resolved.value, request.options, request.context),
      );
    }),
  );

const createTempDirIn = (
  request: pathOpsTypes.TempDirRequest,
): Promise<Result<string, FileError>> => {
  const aborted = abortResult<string>(request.context.abortSignal, undefined);
  if (aborted !== undefined) return Promise.resolve(aborted);
  const { connection } = request.target;
  return run(
    fileResult(
      Effect.gen(function* () {
        const { tmpdir } = yield* Effect.promise(() => connection.info());
        const paths = yield* remotePath(connection);
        const json = yield* remoteRequest({
          connection,
          json: { path: paths.join(tmpdir, request.prefix ?? "tmp-") },
          op: "mkdtemp",
        });
        return json["path"] as string;
      }),
      undefined,
    ),
  );
};

const createTempFileIn = (
  request: pathOpsTypes.TempFileRequest,
): Promise<Result<string, FileError>> => {
  const { connection } = request.target;
  return run(
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => createTempDirIn({ ...request, prefix: "tmp-" }));
      if (!dir.ok) return dir;
      let filePath = "";
      return yield* Effect.gen(function* () {
        const paths = yield* remotePath(connection);
        filePath = paths.join(
          dir.value,
          `${request.prefix ?? ""}${yield* randomUuid}${request.suffix ?? ""}`,
        );
        yield* remoteRequest({
          connection,
          json: { append: false, parents: false, path: filePath },
          op: "write",
          payload: new Uint8Array(0),
        });
        return ok<string, FileError>(filePath);
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.succeed(err<string, FileError>(toFileError(Cause.squash(cause), filePath))),
        ),
      );
    }),
  );
};

const pathOps = {
  absolutePathOf,
  canonicalPathOf,
  createTempDirIn,
  createTempFileIn,
  joinPathIn,
  listFilesAt,
};

export default pathOps;
