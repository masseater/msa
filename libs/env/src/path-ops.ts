import { randomUUID } from "node:crypto";

import type { Context } from "@msa/chord";
import {
  type FileError,
  type FileListing,
  type ListFilesOptions,
  err,
  ok,
  type Result,
} from "@msa/durable/env";
import { Cause, Effect } from "effect";

import { abortResult, fileResult, toFileError } from "./errors.ts";
import {
  type PathRequest,
  type RemoteTarget,
  remoteRequest,
  resolveIn,
  run,
  runFileOp,
} from "./file-op.ts";
import { listFilesOver } from "./list-files.ts";
import { remotePath } from "./remote-path.ts";

export interface ListFilesRequest extends PathRequest {
  readonly options: ListFilesOptions | undefined;
}

export interface TempDirRequest {
  readonly target: RemoteTarget;
  readonly prefix: string | undefined;
  readonly context: Context;
}

export interface TempFileRequest {
  readonly target: RemoteTarget;
  readonly prefix: string | undefined;
  readonly suffix: string | undefined;
  readonly context: Context;
}

export const absolutePathOf = (request: {
  target: RemoteTarget;
  path: string;
}): Promise<Result<string, FileError>> => run(fileResult(resolveIn(request), request.path));

export const joinPathIn = (request: {
  target: RemoteTarget;
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

export const canonicalPathOf = (request: PathRequest): Promise<Result<string, FileError>> => {
  const { connection } = request.target;
  return run(
    runFileOp({
      ...request,
      operation: (resolved) =>
        remoteRequest({ connection, op: "realpath", json: { path: resolved } }).pipe(
          Effect.map((json) => json["path"] as string),
        ),
    }),
  );
};

export const listFilesAt = (request: ListFilesRequest): Promise<Result<FileListing, FileError>> =>
  run(
    Effect.gen(function* () {
      const resolved = yield* fileResult(resolveIn(request), request.path);
      if (!resolved.ok) return resolved;
      return yield* Effect.promise(() =>
        listFilesOver(request.target.connection, resolved.value, request.options, request.context),
      );
    }),
  );

export const createTempDirIn = (request: TempDirRequest): Promise<Result<string, FileError>> => {
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
          op: "mkdtemp",
          json: { path: paths.join(tmpdir, request.prefix ?? "tmp-") },
        });
        return json["path"] as string;
      }),
      undefined,
    ),
  );
};

export const createTempFileIn = (request: TempFileRequest): Promise<Result<string, FileError>> => {
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
          `${request.prefix ?? ""}${randomUUID()}${request.suffix ?? ""}`,
        );
        yield* remoteRequest({
          connection,
          op: "write",
          json: { path: filePath, append: false, parents: false },
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
