import type { Context } from "@msa/chord";
import env from "@msa/durable/env";
import type envTypesModule from "@msa/durable/env.types";

import dirOps from "./dir-ops.ts";
import execModule from "./exec.ts";
import type envTypes from "./index.types.ts";
import mutateOps from "./mutate-ops.ts";
import pathOps from "./path-ops.ts";
import readOps from "./read-ops.ts";
import watchOp from "./watch-op.ts";

const { err, ok } = env;

const {
  absolutePathOf,
  canonicalPathOf,
  createTempDirIn,
  createTempFileIn,
  joinPathIn,
  listFilesAt,
} = pathOps;
const { openBinaryReaderAt, openDirReaderAt, openTextLineReaderAt, readFileAt, readTextLinesAt } =
  readOps;
const { createDirAt, flushAt, removeAt, renameAt, truncateAt, writeAt } = mutateOps;
const { fileInfoAt, listDirAt } = dirOps;
const { watchIn } = watchOp;
const { execIn } = execModule;

type FileResult<T> = Promise<envTypesModule.Result<T, envTypesModule.FileError>>;

export default class RemoteExecutionEnv implements envTypesModule.ExecutionEnv {
  readonly id: string;
  cwd: string;
  readonly connection: envTypes.Connection;
  readonly #shellPath: string | undefined;
  readonly #shellEnv: Record<string, string> | undefined;
  readonly #watchOptions: envTypes.RemoteWatchOptions;
  readonly #running = new Map<number, number>();

  constructor(options: envTypes.RemoteExecutionEnvOptions) {
    this.id = options.id;
    this.cwd = options.cwd;
    this.connection = options.connection;
    this.#shellPath = options.shellPath;
    this.#shellEnv = options.shellEnv;
    this.#watchOptions = options.watch ?? {};
  }

  absolutePath(path: string, _context: Context): FileResult<string> {
    return absolutePathOf({ path, target: this });
  }

  joinPath(parts: string[], _context: Context): FileResult<string> {
    return joinPathIn({ parts, target: this });
  }

  readTextFile(path: string, context: Context): FileResult<string> {
    return readFileAt({ context, encoding: true, path, target: this }) as FileResult<string>;
  }

  readBinaryFile(path: string, context: Context): FileResult<Uint8Array> {
    return readFileAt({ context, encoding: false, path, target: this }) as FileResult<Uint8Array>;
  }

  openBinaryReader(
    path: string,
    options: { noFollow?: boolean } | undefined,
    context: Context,
  ): FileResult<envTypesModule.BinaryReader> {
    return openBinaryReaderAt({
      context,
      noFollow: options?.noFollow === true,
      path,
      target: this,
    });
  }

  openTextLineReader(path: string, context: Context): FileResult<envTypesModule.TextLineReader> {
    return openTextLineReaderAt({ context, path, target: this });
  }

  readTextLines(
    path: string,
    options: { maxLines?: number } | undefined,
    context: Context,
  ): FileResult<string[]> {
    if (options?.maxLines !== undefined && options.maxLines <= 0) return Promise.resolve(ok([]));
    return readTextLinesAt({ context, maxLines: options?.maxLines, path, target: this });
  }

  writeFile(path: string, content: string | Uint8Array, context: Context): FileResult<void> {
    return writeAt({ append: false, content, context, path, target: this });
  }

  appendFile(path: string, content: string | Uint8Array, context: Context): FileResult<void> {
    return writeAt({ append: true, content, context, path, target: this });
  }

  truncateFile(path: string, size: number, context: Context): FileResult<void> {
    return truncateAt({ context, path, size, target: this });
  }

  flushFile(path: string, context: Context): FileResult<void> {
    return flushAt({ context, path, target: this });
  }

  renameFile(sourcePath: string, destinationPath: string, context: Context): FileResult<void> {
    return renameAt({ context, destination: destinationPath, path: sourcePath, target: this });
  }

  fileInfo(path: string, context: Context): FileResult<envTypesModule.FileInfo> {
    return fileInfoAt({ context, path, target: this });
  }

  listDir(path: string, context: Context): FileResult<envTypesModule.FileInfo[]> {
    return listDirAt({ context, path, target: this });
  }

  listFiles(
    path: string,
    options: envTypesModule.ListFilesOptions | undefined,
    context: Context,
  ): FileResult<envTypesModule.FileListing> {
    return listFilesAt({ context, options, path, target: this });
  }

  openDirReader(path: string, context: Context): FileResult<envTypesModule.DirReader> {
    return openDirReaderAt({ context, path, target: this });
  }

  canonicalPath(path: string, context: Context): FileResult<string> {
    return canonicalPathOf({ context, path, target: this });
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
    return createDirAt({ context, path, recursive: options?.recursive ?? true, target: this });
  }

  remove(
    path: string,
    options: { recursive?: boolean; force?: boolean } | undefined,
    context: Context,
  ): FileResult<void> {
    return removeAt({
      context,
      force: options?.force ?? false,
      path,
      recursive: options?.recursive ?? false,
      target: this,
    });
  }

  createTempDir(prefix: string | undefined, context: Context): FileResult<string> {
    return createTempDirIn({ context, prefix, target: this });
  }

  createTempFile(
    options: { prefix?: string; suffix?: string } | undefined,
    context: Context,
  ): FileResult<string> {
    return createTempFileIn({
      context,
      prefix: options?.prefix,
      suffix: options?.suffix,
      target: this,
    });
  }

  watch(
    targets: readonly envTypesModule.WatchTarget[],
    onChange: (change: envTypesModule.WatchChange) => void,
    context: Context,
  ): FileResult<envTypesModule.FileWatcher> {
    return watchIn({ context, onChange, options: this.#watchOptions, target: this, targets });
  }

  exec(
    command: string | readonly string[],
    options: envTypesModule.ShellExecOptions | undefined,
    context: Context,
  ): Promise<envTypesModule.Result<envTypesModule.ShellExecResult, envTypesModule.ExecutionError>> {
    return execIn({
      command,
      context,
      options,
      running: this.#running,
      shellEnv: this.#shellEnv,
      shellPath: this.#shellPath,
      target: this,
    });
  }

  cleanup(_context: Context): Promise<void> {
    for (const [id, session] of this.#running) this.connection.kill(id, session);
    this.#running.clear();
    return Promise.resolve();
  }
}
