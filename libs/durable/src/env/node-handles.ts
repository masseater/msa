import { constants } from "node:fs";
import { type FileHandle, lstat, opendir, open as openFile } from "node:fs/promises";

import { Cause, Effect } from "effect";

import {
  type BinaryReader,
  type DirReader,
  err,
  FileError,
  type FileInfo,
  ok,
  type Result,
  type TextLineReader,
} from "./index.ts";
import { NodeBinaryReader } from "./node-binary-reader.ts";
import { NodeDirReader } from "./node-dir-reader.ts";
import {
  abortResult,
  fileResult,
  isNodeError,
  recoverFileError,
  symlinkRefused,
  toFileError,
} from "./node-errors.ts";
import { directoryNames, type FileRequest } from "./node-files.ts";
import { childPath, fileInfoFromStats } from "./node-paths.ts";
import { NodeTextLineReader } from "./node-text-reader.ts";

const closeQuietly = (closable: { close(): Promise<void> }) =>
  Effect.promise(() => closable.close().catch(() => undefined));

const runOpen = <T>(
  { path, context }: FileRequest,
  open: Effect.Effect<Result<T, FileError>>,
): Promise<Result<T, FileError>> => {
  const aborted = abortResult<T>(context.abortSignal, path);
  return aborted === undefined
    ? Effect.runPromise(recoverFileError(open, path))
    : Promise.resolve(aborted);
};

const keepUnlessAborted = <T, H extends { close(): Promise<void> }>(
  { path, context }: FileRequest,
  handle: H,
  wrap: (handle: H) => T,
) =>
  Effect.gen(function* () {
    const afterOpenAbort = abortResult<T>(context.abortSignal, path);
    if (afterOpenAbort === undefined) return ok<T, FileError>(wrap(handle));
    yield* closeQuietly(handle);
    return afterOpenAbort;
  });

export const openTextLineReader = (
  request: FileRequest,
): Promise<Result<TextLineReader, FileError>> =>
  runOpen(
    request,
    Effect.flatMap(
      Effect.promise(() => openFile(request.path, "r")),
      (file): Effect.Effect<Result<TextLineReader, FileError>> =>
        keepUnlessAborted(request, file, (opened) => new NodeTextLineReader(opened, request.path)),
    ),
  );

export const openDirReader = (request: FileRequest): Promise<Result<DirReader, FileError>> =>
  runOpen(
    request,
    Effect.flatMap(
      Effect.promise(() => opendir(request.path)),
      (dir): Effect.Effect<Result<DirReader, FileError>> =>
        keepUnlessAborted(request, dir, (opened) => new NodeDirReader(opened, request.path, lstat)),
    ),
  );

export interface BinaryOpenRequest extends FileRequest {
  readonly noFollow: boolean;
}

const binaryOpenFlags = Effect.fnUntraced(function* ({ path, noFollow }: BinaryOpenRequest) {
  if (process.platform === "win32") {
    if (noFollow && (yield* Effect.promise(() => lstat(path))).isSymbolicLink()) {
      return undefined;
    }
    return constants.O_RDONLY;
  }
  return constants.O_RDONLY | constants.O_NONBLOCK | (noFollow ? constants.O_NOFOLLOW : 0);
});

const notRegularFile = (path: string, isDirectory: boolean): FileError =>
  isDirectory
    ? new FileError("is_directory", "EISDIR: illegal operation on a directory, read", path)
    : new FileError("invalid", "Not a regular file", path);

const checkedBinaryReader = (request: BinaryOpenRequest, file: FileHandle) =>
  Effect.gen(function* () {
    const stats = yield* Effect.promise(() => file.stat());
    if (!stats.isFile()) {
      yield* closeQuietly(file);
      return err<BinaryReader, FileError>(notRegularFile(request.path, stats.isDirectory()));
    }
    return yield* keepUnlessAborted<BinaryReader, FileHandle>(
      request,
      file,
      (opened) => new NodeBinaryReader(opened, request.path),
    );
  }).pipe(Effect.onError(() => closeQuietly(file)));

const binaryOpenFailure = (request: BinaryOpenRequest, error: unknown): FileError =>
  request.noFollow && isNodeError(error) && (error.code === "ELOOP" || error.code === "EMLINK")
    ? symlinkRefused(request.path, error)
    : toFileError(error, request.path);

export const openBinaryReader = (
  request: BinaryOpenRequest,
): Promise<Result<BinaryReader, FileError>> =>
  runOpen(
    request,
    Effect.gen(function* () {
      const flags = yield* binaryOpenFlags(request);
      if (flags === undefined)
        return err<BinaryReader, FileError>(symlinkRefused(request.path, undefined));
      const file = yield* Effect.promise(() => openFile(request.path, flags));
      return yield* checkedBinaryReader(request, file);
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.succeed(
          err<BinaryReader, FileError>(binaryOpenFailure(request, Cause.squash(cause))),
        ),
      ),
    ),
  );

export const flushFile = (request: FileRequest): Promise<Result<void, FileError>> =>
  runOpen(
    request,
    Effect.acquireUseRelease(
      Effect.promise(() => openFile(request.path, "r+")),
      (file) =>
        Effect.gen(function* () {
          const stats = yield* Effect.promise(() => file.stat());
          if (stats.isDirectory()) {
            return err<void, FileError>(
              new FileError("is_directory", "Is a directory", request.path),
            );
          }
          yield* Effect.promise(() => file.sync());
          return abortResult<void>(request.context.abortSignal, request.path) ?? ok(undefined);
        }),
      closeQuietly,
    ),
  );

export const fileInfo = (request: FileRequest): Promise<Result<FileInfo, FileError>> =>
  runOpen(
    request,
    Effect.map(
      Effect.promise(() => lstat(request.path)),
      (stats) => fileInfoFromStats(request.path, stats),
    ),
  );

const entryInfos = Effect.fnUntraced(function* (request: FileRequest, names: readonly string[]) {
  const infos: FileInfo[] = [];
  for (const name of names) {
    const loopAbort = abortResult<FileInfo[]>(request.context.abortSignal, request.path);
    if (loopAbort !== undefined) return loopAbort;
    const entryPath = childPath(request.path, name);
    const info = yield* fileResult(
      Effect.promise(() => lstat(entryPath)),
      entryPath,
    );
    if (!info.ok) return err<FileInfo[], FileError>(info.error);
    const entry = fileInfoFromStats(entryPath, info.value);
    if (entry.ok) infos.push(entry.value);
  }
  return ok<FileInfo[], FileError>(infos);
});

export const listDir = (request: FileRequest): Promise<Result<FileInfo[], FileError>> =>
  runOpen(
    request,
    Effect.gen(function* () {
      const names = yield* Effect.promise(() => directoryNames(request));
      if (!names.ok) return err<FileInfo[], FileError>(names.error);
      return yield* entryInfos(request, names.value);
    }),
  );
