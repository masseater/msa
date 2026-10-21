import * as NodeServices from "@effect/platform-node/NodeServices";
import { Crypto, Effect, Exit, FileSystem, ManagedRuntime } from "effect";

import decodeModule from "../decode.ts";
import FileError from "../file-error.ts";
import type fileErrorTypes from "../file-error.types.ts";
import resultModule from "../result.ts";
import type resultTypes from "../result.types.ts";
import nodeErrors from "./node-errors.ts";
import type nodeFilesTypes from "./node-files.types.ts";
import nodePaths from "./node-paths.ts";

const nodeRuntime = ManagedRuntime.make(NodeServices.layer);

const { abortResult, fileResult, recoverFileError } = nodeErrors;
const { err, ok } = resultModule;

const { rangeDecoder } = decodeModule;
const { joinPaths, parentPath } = nodePaths;

type FileOp<T> = Effect.Effect<
  resultTypes.Result<T, fileErrorTypes.FileError>,
  never,
  FileSystem.FileSystem
>;

const encodeContent = (content: string | Uint8Array): Uint8Array =>
  typeof content === "string" ? new TextEncoder().encode(content) : content;

const runFileOp = <T>(
  { path, context }: nodeFilesTypes.FileRequest,
  op: FileOp<T>,
): Promise<resultTypes.Result<T, fileErrorTypes.FileError>> => {
  const aborted = abortResult<T>(context.abortSignal, path);
  return aborted === undefined ? nodeRuntime.runPromise(op) : Promise.resolve(aborted);
};

const runCancellableFileOp = <T>(
  { path, context }: nodeFilesTypes.FileRequest,
  op: FileOp<T>,
): Promise<resultTypes.Result<T, fileErrorTypes.FileError>> => {
  const signal = context.abortSignal;
  const aborted = abortResult<T>(signal, path);
  if (aborted !== undefined) return Promise.resolve(aborted);
  return nodeRuntime
    .runPromiseExit(op, signal === undefined ? undefined : { signal })
    .then((exit) =>
      Exit.isSuccess(exit)
        ? exit.value
        : err<T, fileErrorTypes.FileError>(
            new FileError("aborted", "The operation was aborted", path),
          ),
    );
};

const readBinaryFile = (
  request: nodeFilesTypes.FileRequest,
): Promise<resultTypes.Result<Uint8Array, fileErrorTypes.FileError>> =>
  runCancellableFileOp(
    request,
    fileResult(
      FileSystem.FileSystem.use((fs) => fs.readFile(request.path)),
      request.path,
    ),
  );

const readTextFile = (
  request: nodeFilesTypes.FileRequest,
): Promise<resultTypes.Result<string, fileErrorTypes.FileError>> =>
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

const writeFile = (
  request: nodeFilesTypes.WriteRequest,
): Promise<resultTypes.Result<void, fileErrorTypes.FileError>> => {
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

const appendFile = (
  request: nodeFilesTypes.WriteRequest,
): Promise<resultTypes.Result<void, fileErrorTypes.FileError>> => {
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

const truncateFile = (
  request: nodeFilesTypes.TruncateRequest,
): Promise<resultTypes.Result<void, fileErrorTypes.FileError>> => {
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

const renameFile = (
  request: nodeFilesTypes.RenameRequest,
): Promise<resultTypes.Result<void, fileErrorTypes.FileError>> =>
  runFileOp(
    request,
    fileResult(
      FileSystem.FileSystem.use((fs) => fs.rename(request.source, request.path)),
      request.source,
    ),
  );

const canonicalPath = (
  request: nodeFilesTypes.FileRequest,
): Promise<resultTypes.Result<string, fileErrorTypes.FileError>> =>
  runFileOp(
    request,
    fileResult(
      FileSystem.FileSystem.use((fs) => fs.realPath(request.path)),
      request.path,
    ),
  );

const createDir = (
  request: nodeFilesTypes.CreateDirRequest,
): Promise<resultTypes.Result<void, fileErrorTypes.FileError>> =>
  runFileOp(
    request,
    fileResult(
      FileSystem.FileSystem.use((fs) =>
        Effect.asVoid(fs.makeDirectory(request.path, { recursive: request.recursive })),
      ),
      request.path,
    ),
  );

const removePath = (
  request: nodeFilesTypes.RemoveRequest,
): Promise<resultTypes.Result<void, fileErrorTypes.FileError>> =>
  runFileOp(
    request,
    fileResult(
      FileSystem.FileSystem.use((fs) =>
        fs.remove(request.path, { force: request.force, recursive: request.recursive }),
      ),
      request.path,
    ),
  );

const directoryNames = (
  request: nodeFilesTypes.FileRequest,
): Promise<resultTypes.Result<string[], fileErrorTypes.FileError>> =>
  runFileOp(
    request,
    fileResult(
      FileSystem.FileSystem.use((fs) => fs.readDirectory(request.path)),
      request.path,
    ),
  );

const createTempDir = ({
  prefix,
  context,
}: nodeFilesTypes.TempDirRequest): Promise<
  resultTypes.Result<string, fileErrorTypes.FileError>
> => {
  const aborted = abortResult<string>(context.abortSignal, undefined);
  if (aborted !== undefined) return Promise.resolve(aborted);
  return nodeRuntime.runPromise(
    fileResult(
      FileSystem.FileSystem.use((fs) => fs.makeTempDirectory({ prefix })),
      undefined,
    ),
  );
};

const createEmptyTempFile = ({
  directory,
  prefix,
  suffix,
}: nodeFilesTypes.TempFileRequest): Promise<resultTypes.Result<string, fileErrorTypes.FileError>> =>
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

const nodeFiles = {
  appendFile,
  canonicalPath,
  createDir,
  createEmptyTempFile,
  createTempDir,
  directoryNames,
  readBinaryFile,
  readTextFile,
  removePath,
  renameFile,
  truncateFile,
  writeFile,
};

export default nodeFiles;
