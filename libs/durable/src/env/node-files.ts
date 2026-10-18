import type { Context } from "@msa/chord";
import { Crypto, Effect, Exit, FileSystem } from "effect";

import { nodeRuntime } from "../node-runtime.ts";
import { rangeDecoder } from "./decode.ts";
import { FileError } from "./file-error.ts";
import { abortResult, fileResult, recoverFileError } from "./node-errors.ts";
import { joinPaths, parentPath } from "./node-paths.ts";
import { err, ok, type Result } from "./result.ts";

type FileOp<T> = Effect.Effect<Result<T, FileError>, never, FileSystem.FileSystem>;

export interface FileRequest {
  readonly path: string;
  readonly context: Context;
}

export interface WriteRequest extends FileRequest {
  readonly content: string | Uint8Array;
}

const encodeContent = (content: string | Uint8Array): Uint8Array =>
  typeof content === "string" ? new TextEncoder().encode(content) : content;

const runFileOp = <T>(
  { path, context }: FileRequest,
  op: FileOp<T>,
): Promise<Result<T, FileError>> => {
  const aborted = abortResult<T>(context.abortSignal, path);
  return aborted === undefined ? nodeRuntime.runPromise(op) : Promise.resolve(aborted);
};

const runCancellableFileOp = <T>(
  { path, context }: FileRequest,
  op: FileOp<T>,
): Promise<Result<T, FileError>> => {
  const signal = context.abortSignal;
  const aborted = abortResult<T>(signal, path);
  if (aborted !== undefined) return Promise.resolve(aborted);
  return nodeRuntime
    .runPromiseExit(op, signal === undefined ? undefined : { signal })
    .then((exit) =>
      Exit.isSuccess(exit)
        ? exit.value
        : err<T, FileError>(new FileError("aborted", "The operation was aborted", path)),
    );
};

export const readBinaryFile = (request: FileRequest): Promise<Result<Uint8Array, FileError>> =>
  runCancellableFileOp(
    request,
    fileResult(
      FileSystem.FileSystem.use((fs) => fs.readFile(request.path)),
      request.path,
    ),
  );

export const readTextFile = (request: FileRequest): Promise<Result<string, FileError>> =>
  runCancellableFileOp(
    request,
    fileResult(
      FileSystem.FileSystem.use((fs) => fs.readFile(request.path)).pipe(
        Effect.map((bytes) => rangeDecoder().decode(bytes)),
      ),
      request.path,
    ),
  );

const makeParentDirectory = (path: string) =>
  FileSystem.FileSystem.use((fs) => fs.makeDirectory(parentPath(path), { recursive: true }));

export const writeFile = (request: WriteRequest): Promise<Result<void, FileError>> => {
  const { path, context, content } = request;
  return runFileOp(
    request,
    recoverFileError(
      Effect.gen(function* () {
        yield* makeParentDirectory(path);
        const afterMkdirAbort = abortResult<void>(context.abortSignal, path);
        if (afterMkdirAbort !== undefined) return afterMkdirAbort;
        return yield* Effect.promise(() =>
          runCancellableFileOp(
            request,
            fileResult(
              FileSystem.FileSystem.use((fs) => fs.writeFile(path, encodeContent(content))),
              path,
            ),
          ),
        );
      }),
      path,
    ),
  );
};

export const appendFile = (request: WriteRequest): Promise<Result<void, FileError>> => {
  const { path, context, content } = request;
  return runFileOp(
    request,
    recoverFileError(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* makeParentDirectory(path);
        const afterMkdirAbort = abortResult<void>(context.abortSignal, path);
        if (afterMkdirAbort !== undefined) return afterMkdirAbort;
        yield* fs.writeFile(path, encodeContent(content), { flag: "a" });
        return abortResult<void>(context.abortSignal, path) ?? ok(undefined);
      }),
      path,
    ),
  );
};

export interface TruncateRequest extends FileRequest {
  readonly size: number;
}

export const truncateFile = (request: TruncateRequest): Promise<Result<void, FileError>> => {
  const { path, context, size } = request;
  const aborted = abortResult<void>(context.abortSignal, path);
  if (aborted !== undefined) return Promise.resolve(aborted);
  if (!Number.isSafeInteger(size) || size < 0) {
    return Promise.resolve(
      err(new FileError("invalid", "File size must be a non-negative safe integer", path)),
    );
  }
  return nodeRuntime.runPromise(
    recoverFileError(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.truncate(path, size);
        return abortResult<void>(context.abortSignal, path) ?? ok(undefined);
      }),
      path,
    ),
  );
};

export interface RenameRequest extends FileRequest {
  readonly source: string;
}

export const renameFile = (request: RenameRequest): Promise<Result<void, FileError>> =>
  runFileOp(
    request,
    fileResult(
      FileSystem.FileSystem.use((fs) => fs.rename(request.source, request.path)),
      request.source,
    ),
  );

export const canonicalPath = (request: FileRequest): Promise<Result<string, FileError>> =>
  runFileOp(
    request,
    fileResult(
      FileSystem.FileSystem.use((fs) => fs.realPath(request.path)),
      request.path,
    ),
  );

export interface CreateDirRequest extends FileRequest {
  readonly recursive: boolean;
}

export const createDir = (request: CreateDirRequest): Promise<Result<void, FileError>> =>
  runFileOp(
    request,
    fileResult(
      FileSystem.FileSystem.use((fs) =>
        Effect.asVoid(fs.makeDirectory(request.path, { recursive: request.recursive })),
      ),
      request.path,
    ),
  );

export interface RemoveRequest extends FileRequest {
  readonly recursive: boolean;
  readonly force: boolean;
}

export const removePath = (request: RemoveRequest): Promise<Result<void, FileError>> =>
  runFileOp(
    request,
    fileResult(
      FileSystem.FileSystem.use((fs) =>
        fs.remove(request.path, { recursive: request.recursive, force: request.force }),
      ),
      request.path,
    ),
  );

export const directoryNames = (request: FileRequest): Promise<Result<string[], FileError>> =>
  runFileOp(
    request,
    fileResult(
      FileSystem.FileSystem.use((fs) => fs.readDirectory(request.path)),
      request.path,
    ),
  );

export interface TempDirRequest {
  readonly prefix: string;
  readonly context: Context;
}

export const createTempDir = ({
  prefix,
  context,
}: TempDirRequest): Promise<Result<string, FileError>> => {
  const aborted = abortResult<string>(context.abortSignal, undefined);
  if (aborted !== undefined) return Promise.resolve(aborted);
  return nodeRuntime.runPromise(
    fileResult(
      FileSystem.FileSystem.use((fs) => fs.makeTempDirectory({ prefix })),
      undefined,
    ),
  );
};

export interface TempFileRequest {
  readonly directory: string;
  readonly prefix: string;
  readonly suffix: string;
}

export const createEmptyTempFile = ({
  directory,
  prefix,
  suffix,
}: TempFileRequest): Promise<Result<string, FileError>> =>
  nodeRuntime.runPromise(
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto;
      const id = yield* Effect.orDie(crypto.randomUUIDv4);
      const path = joinPaths(directory, `${prefix}${id}${suffix}`);
      return yield* fileResult(
        Effect.as(
          FileSystem.FileSystem.use((fs) => fs.writeFile(path, new Uint8Array(0))),
          path,
        ),
        path,
      );
    }),
  );
