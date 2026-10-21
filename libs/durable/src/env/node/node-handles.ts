import { constants, createWriteStream } from "node:fs";
import { type FileHandle, lstat, open as openFile, opendir } from "node:fs/promises";

import { Cause, Effect } from "effect";

import env from "../index.ts";
import type envTypes from "../index.types.ts";
import type nodeFilesTypes from "./node-files.types.ts";
import type nodeHandlesTypes from "./node-handles.types.ts";
import nodeIoKit from "./node-io-kit.ts";

const { NodeBinaryReader, NodeDirReader, nodeErrors, nodeFiles, nodePaths, NodeTextLineReader } =
  nodeIoKit;

const { abortResult, fileResult, isNodeError, recoverFileError, symlinkRefused, toFileError } =
  nodeErrors;
const { FileError, err, ok } = env;
const { childPath, fileInfoFromStats } = nodePaths;
const { directoryNames } = nodeFiles;

const closeQuietly = (closable: { close(): Promise<void> }) =>
  Effect.promise(() => closable.close().catch(() => undefined));

const runOpen = <T>(
  { path, context }: nodeFilesTypes.FileRequest,
  open: Effect.Effect<envTypes.Result<T, envTypes.FileError>>,
): Promise<envTypes.Result<T, envTypes.FileError>> => {
  const aborted = abortResult<T>(context.abortSignal, path);
  return aborted === undefined
    ? Effect.runPromise(recoverFileError(open, path))
    : Promise.resolve(aborted);
};

const keepUnlessAborted = <T, H extends { close(): Promise<void> }>(
  { path, context }: nodeFilesTypes.FileRequest,
  handle: H,
  wrap: (handle: H) => T,
) =>
  Effect.gen(function* () {
    const afterOpenAbort = abortResult<T>(context.abortSignal, path);
    if (afterOpenAbort === undefined) return ok<T, envTypes.FileError>(wrap(handle));
    yield* closeQuietly(handle);
    return afterOpenAbort;
  });

const openTextLineReader = (
  request: nodeFilesTypes.FileRequest,
): Promise<envTypes.Result<envTypes.TextLineReader, envTypes.FileError>> =>
  runOpen(
    request,
    Effect.flatMap(
      Effect.promise(() => openFile(request.path, "r")),
      (file): Effect.Effect<envTypes.Result<envTypes.TextLineReader, envTypes.FileError>> =>
        keepUnlessAborted(request, file, (opened) => new NodeTextLineReader(opened, request.path)),
    ),
  );

const openDirReader = (
  request: nodeFilesTypes.FileRequest,
): Promise<envTypes.Result<envTypes.DirReader, envTypes.FileError>> =>
  runOpen(
    request,
    Effect.flatMap(
      Effect.promise(() => opendir(request.path)),
      (dir): Effect.Effect<envTypes.Result<envTypes.DirReader, envTypes.FileError>> =>
        keepUnlessAborted(request, dir, (opened) => new NodeDirReader(opened, request.path, lstat)),
    ),
  );

const binaryOpenFlags = Effect.fnUntraced(function* ({
  path,
  noFollow,
}: nodeHandlesTypes.BinaryOpenRequest) {
  if (process.platform === "win32") {
    if (noFollow && (yield* Effect.promise(() => lstat(path))).isSymbolicLink()) {
      return undefined;
    }
    return constants.O_RDONLY;
  }
  return constants.O_RDONLY | constants.O_NONBLOCK | (noFollow ? constants.O_NOFOLLOW : 0);
});

const notRegularFile = (path: string, isDirectory: boolean): envTypes.FileError =>
  isDirectory
    ? new FileError("is_directory", "EISDIR: illegal operation on a directory, read", path)
    : new FileError("invalid", "Not a regular file", path);

const checkedBinaryReader = (request: nodeHandlesTypes.BinaryOpenRequest, file: FileHandle) =>
  Effect.gen(function* () {
    const stats = yield* Effect.promise(() => file.stat());
    if (!stats.isFile()) {
      yield* closeQuietly(file);
      return err<envTypes.BinaryReader, envTypes.FileError>(
        notRegularFile(request.path, stats.isDirectory()),
      );
    }
    return yield* keepUnlessAborted<envTypes.BinaryReader, FileHandle>(
      request,
      file,
      (opened) => new NodeBinaryReader(opened, request.path),
    );
  }).pipe(Effect.onError(() => closeQuietly(file)));

const binaryOpenFailure = (
  request: nodeHandlesTypes.BinaryOpenRequest,
  error: unknown,
): envTypes.FileError =>
  request.noFollow && isNodeError(error) && (error.code === "ELOOP" || error.code === "EMLINK")
    ? symlinkRefused(request.path, error)
    : toFileError(error, request.path);

const openBinaryReader = (
  request: nodeHandlesTypes.BinaryOpenRequest,
): Promise<envTypes.Result<envTypes.BinaryReader, envTypes.FileError>> =>
  runOpen(
    request,
    Effect.gen(function* () {
      const flags = yield* binaryOpenFlags(request);
      if (flags === undefined)
        return err<envTypes.BinaryReader, envTypes.FileError>(
          symlinkRefused(request.path, undefined),
        );
      const file = yield* Effect.promise(() => openFile(request.path, flags));
      return yield* checkedBinaryReader(request, file);
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.succeed(
          err<envTypes.BinaryReader, envTypes.FileError>(
            binaryOpenFailure(request, Cause.squash(cause)),
          ),
        ),
      ),
    ),
  );

const flushFile = (
  request: nodeFilesTypes.FileRequest,
): Promise<envTypes.Result<void, envTypes.FileError>> =>
  runOpen(
    request,
    Effect.acquireUseRelease(
      Effect.promise(() => openFile(request.path, "r+")),
      (file) =>
        Effect.gen(function* () {
          const stats = yield* Effect.promise(() => file.stat());
          if (stats.isDirectory()) {
            return err<void, envTypes.FileError>(
              new FileError("is_directory", "Is a directory", request.path),
            );
          }
          yield* Effect.promise(() => file.sync());
          return abortResult<void>(request.context.abortSignal, request.path) ?? ok(undefined);
        }),
      closeQuietly,
    ),
  );

const fileInfo = (
  request: nodeFilesTypes.FileRequest,
): Promise<envTypes.Result<envTypes.FileInfo, envTypes.FileError>> =>
  runOpen(
    request,
    Effect.map(
      Effect.promise(() => lstat(request.path)),
      (stats) => fileInfoFromStats(request.path, stats),
    ),
  );

const entryInfos = Effect.fnUntraced(function* (
  request: nodeFilesTypes.FileRequest,
  names: readonly string[],
) {
  const infos: envTypes.FileInfo[] = [];
  for (const name of names) {
    const loopAbort = abortResult<envTypes.FileInfo[]>(request.context.abortSignal, request.path);
    if (loopAbort !== undefined) return loopAbort;
    const entryPath = childPath(request.path, name);
    const info = yield* fileResult(
      Effect.promise(() => lstat(entryPath)),
      entryPath,
    );
    if (!info.ok) return err<envTypes.FileInfo[], envTypes.FileError>(info.error);
    const entry = fileInfoFromStats(entryPath, info.value);
    if (entry.ok) infos.push(entry.value);
  }
  return ok<envTypes.FileInfo[], envTypes.FileError>(infos);
});

const listDir = (
  request: nodeFilesTypes.FileRequest,
): Promise<envTypes.Result<envTypes.FileInfo[], envTypes.FileError>> =>
  runOpen(
    request,
    Effect.gen(function* () {
      const names = yield* Effect.promise(() => directoryNames(request));
      if (!names.ok) return err<envTypes.FileInfo[], envTypes.FileError>(names.error);
      return yield* entryInfos(request, names.value);
    }),
  );

const openAppendStream = ({
  path,
  highWaterMark,
}: nodeHandlesTypes.AppendStreamRequest): nodeHandlesTypes.AppendStream =>
  createWriteStream(path, { flags: "a", highWaterMark });

const nodeHandles = {
  fileInfo,
  flushFile,
  listDir,
  openAppendStream,
  openBinaryReader,
  openDirReader,
  openTextLineReader,
};

export default nodeHandles;
