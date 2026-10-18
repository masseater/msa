import type { Context } from "@msa/chord";
import { Effect } from "effect";

import {
  type BinaryReader,
  type DirReader,
  type ExecutionEnv,
  type ExecutionError,
  err,
  type FileError,
  type FileInfo,
  type FileWatcher,
  ok,
  type Result,
  type ShellExecOptions,
  type ShellExecResult,
  type TextLineReader,
  type WatchChange,
  type WatchTarget,
} from "./index.ts";
import { abortResult, recoverFileError } from "./node-errors.ts";
import { execute } from "./node-exec.ts";
import * as Files from "./node-files.ts";
import * as Handles from "./node-handles.ts";
import { joinPaths, resolvePath } from "./node-paths.ts";
import { killProcessTree } from "./node-process.ts";
import { NodeFileWatcher, type NodeWatchOptions } from "./node-watch.ts";

export interface NodeExecutionEnvOptions {
  cwd: string;
  shellPath?: string;
  shellEnv?: NodeJS.ProcessEnv;
  watch?: NodeWatchOptions;
}

const readLines = Effect.fnUntraced(function* (
  reader: TextLineReader,
  maxLines: number | undefined,
  context: Context,
) {
  const lines: string[] = [];
  for (;;) {
    if (maxLines !== undefined && lines.length >= maxLines) break;
    const line = yield* Effect.promise(() => reader.readLine(context));
    if (!line.ok) return err<string[], FileError>(line.error);
    if (line.value === undefined) break;
    lines.push(line.value.text);
  }
  return ok<string[], FileError>(lines);
});

export class NodeExecutionEnv implements ExecutionEnv {
  readonly id: string = "node:local";
  cwd: string;
  private readonly shellPath: string | undefined;
  private readonly shellEnv: NodeJS.ProcessEnv | undefined;
  private readonly watchOptions: NodeWatchOptions;
  private readonly activeChildPids = new Set<number>();

  constructor(options: NodeExecutionEnvOptions) {
    this.cwd = options.cwd;
    this.shellPath = options.shellPath;
    this.shellEnv = options.shellEnv;
    this.watchOptions = options.watch ?? {};
  }

  private at(path: string, context: Context): Files.FileRequest {
    return { path: resolvePath(this.cwd, path), context };
  }

  watch(
    targets: readonly WatchTarget[],
    onChange: (change: WatchChange) => void,
    context: Context,
  ): Promise<Result<FileWatcher, FileError>> {
    const aborted = abortResult<FileWatcher>(context.abortSignal, undefined);
    if (aborted !== undefined) return Promise.resolve(aborted);
    const opening = Effect.gen({ self: this }, function* () {
      const watcher = yield* Effect.promise(() =>
        NodeFileWatcher.open(
          targets,
          (path) => resolvePath(this.cwd, path),
          onChange,
          this.watchOptions,
        ),
      );
      const afterOpenAbort = abortResult<FileWatcher>(context.abortSignal, undefined);
      if (afterOpenAbort === undefined) return ok<FileWatcher, FileError>(watcher);
      yield* Effect.promise(() => watcher.close(context));
      return afterOpenAbort;
    });
    return Effect.runPromise(recoverFileError(opening, undefined));
  }

  absolutePath(path: string, _context: Context): Promise<Result<string, FileError>> {
    return Promise.resolve(ok(resolvePath(this.cwd, path)));
  }

  joinPath(parts: string[], _context: Context): Promise<Result<string, FileError>> {
    return Promise.resolve(ok(joinPaths(...parts)));
  }

  exec(
    command: string | readonly string[],
    options: ShellExecOptions | undefined,
    context: Context,
  ): Promise<Result<ShellExecResult, ExecutionError>> {
    return execute({
      target: {
        cwd: this.cwd,
        shellPath: this.shellPath,
        shellEnv: this.shellEnv,
        activeChildPids: this.activeChildPids,
        createTempFile: Effect.promise(() =>
          this.createTempFile({ prefix: "msa-output-", suffix: ".log" }, context),
        ),
      },
      command,
      options,
      context,
    });
  }

  openTextLineReader(path: string, context: Context): Promise<Result<TextLineReader, FileError>> {
    return Handles.openTextLineReader(this.at(path, context));
  }

  readTextFile(path: string, context: Context): Promise<Result<string, FileError>> {
    return Files.readTextFile(this.at(path, context));
  }

  readTextLines(
    path: string,
    options: { maxLines?: number } | undefined,
    context: Context,
  ): Promise<Result<string[], FileError>> {
    const maxLines = options?.maxLines;
    if (maxLines !== undefined && maxLines <= 0) return Promise.resolve(ok([]));
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        const opened = yield* Effect.promise(() => this.openTextLineReader(path, context));
        if (!opened.ok) return err<string[], FileError>(opened.error);
        const reader = opened.value;
        return yield* readLines(reader, maxLines, context).pipe(
          Effect.ensuring(Effect.promise(() => reader.close(context))),
        );
      }),
    );
  }

  readBinaryFile(path: string, context: Context): Promise<Result<Uint8Array, FileError>> {
    return Files.readBinaryFile(this.at(path, context));
  }

  openBinaryReader(
    path: string,
    options: { noFollow?: boolean } | undefined,
    context: Context,
  ): Promise<Result<BinaryReader, FileError>> {
    const noFollow = options?.noFollow === true;
    return Handles.openBinaryReader({ ...this.at(path, context), noFollow });
  }

  writeFile(
    path: string,
    content: string | Uint8Array,
    context: Context,
  ): Promise<Result<void, FileError>> {
    return Files.writeFile({ ...this.at(path, context), content });
  }

  appendFile(
    path: string,
    content: string | Uint8Array,
    context: Context,
  ): Promise<Result<void, FileError>> {
    return Files.appendFile({ ...this.at(path, context), content });
  }

  truncateFile(path: string, size: number, context: Context): Promise<Result<void, FileError>> {
    return Files.truncateFile({ ...this.at(path, context), size });
  }

  flushFile(path: string, context: Context): Promise<Result<void, FileError>> {
    return Handles.flushFile(this.at(path, context));
  }

  renameFile(
    sourcePath: string,
    destinationPath: string,
    context: Context,
  ): Promise<Result<void, FileError>> {
    const source = resolvePath(this.cwd, sourcePath);
    return Files.renameFile({ ...this.at(destinationPath, context), source });
  }

  fileInfo(path: string, context: Context): Promise<Result<FileInfo, FileError>> {
    return Handles.fileInfo(this.at(path, context));
  }

  listDir(path: string, context: Context): Promise<Result<FileInfo[], FileError>> {
    return Handles.listDir(this.at(path, context));
  }

  openDirReader(path: string, context: Context): Promise<Result<DirReader, FileError>> {
    return Handles.openDirReader(this.at(path, context));
  }

  canonicalPath(path: string, context: Context): Promise<Result<string, FileError>> {
    return Files.canonicalPath(this.at(path, context));
  }

  exists(path: string, context: Context): Promise<Result<boolean, FileError>> {
    return this.fileInfo(path, context).then((result) => {
      if (result.ok) return ok(true);
      return result.error.code === "not_found" ? ok(false) : err(result.error);
    });
  }

  createDir(
    path: string,
    options: { recursive?: boolean } | undefined,
    context: Context,
  ): Promise<Result<void, FileError>> {
    const recursive = options?.recursive ?? true;
    return Files.createDir({ ...this.at(path, context), recursive });
  }

  remove(
    path: string,
    options: { recursive?: boolean; force?: boolean } | undefined,
    context: Context,
  ): Promise<Result<void, FileError>> {
    const recursive = options?.recursive ?? false;
    const force = options?.force ?? false;
    return Files.removePath({ ...this.at(path, context), recursive, force });
  }

  createTempDir(prefix: string | undefined, context: Context): Promise<Result<string, FileError>> {
    return Files.createTempDir({ prefix: prefix ?? "tmp-", context });
  }

  createTempFile(
    options: { prefix?: string; suffix?: string } | undefined,
    context: Context,
  ): Promise<Result<string, FileError>> {
    return this.createTempDir("tmp-", context).then((directory) =>
      directory.ok
        ? Files.createEmptyTempFile({
            directory: directory.value,
            prefix: options?.prefix ?? "",
            suffix: options?.suffix ?? "",
          })
        : directory,
    );
  }

  cleanup(_context: Context): Promise<void> {
    for (const pid of this.activeChildPids) killProcessTree(pid);
    this.activeChildPids.clear();
    return Promise.resolve();
  }
}

export type { NodeWatchOptions } from "./node-watch.ts";
