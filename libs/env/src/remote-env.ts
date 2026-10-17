import type { Context } from "@msa/chord";
import {
  type BinaryReader,
  type DirReader,
  type ExecutionEnv,
  type ExecutionError,
  err,
  type FileError,
  type FileInfo,
  type FileListing,
  type FileWatcher,
  type ListFilesOptions,
  ok,
  type Result,
  type ShellExecOptions,
  type ShellExecResult,
  type TextLineReader,
  type WatchChange,
  type WatchTarget,
} from "@msa/durable/env";

import type { Connection } from "./connection.ts";
import { fileInfoAt, listDirAt } from "./dir-ops.ts";
import { execIn } from "./exec.ts";
import { createDirAt, flushAt, removeAt, renameAt, truncateAt, writeAt } from "./mutate-ops.ts";
import {
  absolutePathOf,
  canonicalPathOf,
  createTempDirIn,
  createTempFileIn,
  joinPathIn,
  listFilesAt,
} from "./path-ops.ts";
import {
  openBinaryReaderAt,
  openDirReaderAt,
  openTextLineReaderAt,
  readFileAt,
  readTextLinesAt,
} from "./read-ops.ts";
import { watchIn } from "./watch-op.ts";
import type { RemoteWatchOptions } from "./watch.ts";

export interface RemoteExecutionEnvOptions {
  connection: Connection;
  id: string;
  cwd: string;
  shellPath?: string;
  shellEnv?: Record<string, string>;
  watch?: RemoteWatchOptions;
}

type FileResult<T> = Promise<Result<T, FileError>>;

export class RemoteExecutionEnv implements ExecutionEnv {
  readonly id: string;
  cwd: string;
  readonly connection: Connection;
  readonly #shellPath: string | undefined;
  readonly #shellEnv: Record<string, string> | undefined;
  readonly #watchOptions: RemoteWatchOptions;
  readonly #running = new Map<number, number>();

  constructor(options: RemoteExecutionEnvOptions) {
    this.id = options.id;
    this.cwd = options.cwd;
    this.connection = options.connection;
    this.#shellPath = options.shellPath;
    this.#shellEnv = options.shellEnv;
    this.#watchOptions = options.watch ?? {};
  }

  absolutePath(path: string, _context: Context): FileResult<string> {
    return absolutePathOf({ target: this, path });
  }

  joinPath(parts: string[], _context: Context): FileResult<string> {
    return joinPathIn({ target: this, parts });
  }

  readTextFile(path: string, context: Context): FileResult<string> {
    return readFileAt({ target: this, path, context, encoding: true }) as FileResult<string>;
  }

  readBinaryFile(path: string, context: Context): FileResult<Uint8Array> {
    return readFileAt({ target: this, path, context, encoding: false }) as FileResult<Uint8Array>;
  }

  openBinaryReader(
    path: string,
    options: { noFollow?: boolean } | undefined,
    context: Context,
  ): FileResult<BinaryReader> {
    return openBinaryReaderAt({
      target: this,
      path,
      context,
      noFollow: options?.noFollow === true,
    });
  }

  openTextLineReader(path: string, context: Context): FileResult<TextLineReader> {
    return openTextLineReaderAt({ target: this, path, context });
  }

  readTextLines(
    path: string,
    options: { maxLines?: number } | undefined,
    context: Context,
  ): FileResult<string[]> {
    if (options?.maxLines !== undefined && options.maxLines <= 0) return Promise.resolve(ok([]));
    return readTextLinesAt({ target: this, path, context, maxLines: options?.maxLines });
  }

  writeFile(path: string, content: string | Uint8Array, context: Context): FileResult<void> {
    return writeAt({ target: this, path, context, content, append: false });
  }

  appendFile(path: string, content: string | Uint8Array, context: Context): FileResult<void> {
    return writeAt({ target: this, path, context, content, append: true });
  }

  truncateFile(path: string, size: number, context: Context): FileResult<void> {
    return truncateAt({ target: this, path, context, size });
  }

  flushFile(path: string, context: Context): FileResult<void> {
    return flushAt({ target: this, path, context });
  }

  renameFile(sourcePath: string, destinationPath: string, context: Context): FileResult<void> {
    return renameAt({ target: this, path: sourcePath, destination: destinationPath, context });
  }

  fileInfo(path: string, context: Context): FileResult<FileInfo> {
    return fileInfoAt({ target: this, path, context });
  }

  listDir(path: string, context: Context): FileResult<FileInfo[]> {
    return listDirAt({ target: this, path, context });
  }

  listFiles(
    path: string,
    options: ListFilesOptions | undefined,
    context: Context,
  ): FileResult<FileListing> {
    return listFilesAt({ target: this, path, options, context });
  }

  openDirReader(path: string, context: Context): FileResult<DirReader> {
    return openDirReaderAt({ target: this, path, context });
  }

  canonicalPath(path: string, context: Context): FileResult<string> {
    return canonicalPathOf({ target: this, path, context });
  }

  exists(path: string, context: Context): FileResult<boolean> {
    return this.fileInfo(path, context).then((result) => {
      if (result.ok) return ok(true);
      if (result.error.code === "not_found") return ok(false);
      return err(result.error);
    });
  }

  createDir(
    path: string,
    options: { recursive?: boolean } | undefined,
    context: Context,
  ): FileResult<void> {
    return createDirAt({ target: this, path, context, recursive: options?.recursive ?? true });
  }

  remove(
    path: string,
    options: { recursive?: boolean; force?: boolean } | undefined,
    context: Context,
  ): FileResult<void> {
    return removeAt({
      target: this,
      path,
      context,
      recursive: options?.recursive ?? false,
      force: options?.force ?? false,
    });
  }

  createTempDir(prefix: string | undefined, context: Context): FileResult<string> {
    return createTempDirIn({ target: this, prefix, context });
  }

  createTempFile(
    options: { prefix?: string; suffix?: string } | undefined,
    context: Context,
  ): FileResult<string> {
    return createTempFileIn({
      target: this,
      prefix: options?.prefix,
      suffix: options?.suffix,
      context,
    });
  }

  watch(
    targets: readonly WatchTarget[],
    onChange: (change: WatchChange) => void,
    context: Context,
  ): FileResult<FileWatcher> {
    return watchIn({ target: this, targets, onChange, options: this.#watchOptions, context });
  }

  exec(
    command: string | readonly string[],
    options: ShellExecOptions | undefined,
    context: Context,
  ): Promise<Result<ShellExecResult, ExecutionError>> {
    return execIn({
      target: this,
      command,
      options,
      context,
      shellEnv: this.#shellEnv,
      shellPath: this.#shellPath,
      running: this.#running,
    });
  }

  cleanup(_context: Context): Promise<void> {
    for (const [id, session] of this.#running) this.connection.kill(id, session);
    this.#running.clear();
    return Promise.resolve();
  }
}
