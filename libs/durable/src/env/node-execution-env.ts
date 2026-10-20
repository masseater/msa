import type chordTypes from "@msa/chord/index.types";
import { Effect } from "effect";

import env from "./index.ts";
import type envTypes from "./index.types.ts";
import type nodeTypes from "./node.types.ts";
import type nodeFilesTypes from "./node/node-files.types.ts";
import nodeKit from "./node/node-kit.ts";
import type nodeWatchTypes from "./node/node-watch.types.ts";

const { nodeErrors, nodeExec, nodeFiles, nodeHandles, nodePaths, nodeProcess, NodeFileWatcher } =
  nodeKit;
const { err, ok } = env;
const { joinPaths, resolvePath } = nodePaths;
const { abortResult, recoverFileError } = nodeErrors;
const { execute } = nodeExec;
const { killProcessTree } = nodeProcess;

const readLines = Effect.fnUntraced(function* (
  reader: envTypes.TextLineReader,
  maxLines: number | undefined,
  context: chordTypes.Context,
) {
  const lines: string[] = [];
  for (;;) {
    if (maxLines !== undefined && lines.length >= maxLines) break;
    const line = yield* Effect.promise(() => reader.readLine(context));
    if (!line.ok) return err<string[], envTypes.FileError>(line.error);
    if (line.value === undefined) break;
    lines.push(line.value.text);
  }
  return ok<string[], envTypes.FileError>(lines);
});

export default class NodeExecutionEnv implements envTypes.ExecutionEnv {
  readonly id: string = "node:local";
  cwd: string;
  private readonly shellPath: string | undefined;
  private readonly shellEnv: NodeJS.ProcessEnv | undefined;
  private readonly watchOptions: nodeWatchTypes.NodeWatchOptions;
  private readonly activeChildPids = new Set<number>();

  constructor(options: nodeTypes.NodeExecutionEnvOptions) {
    this.cwd = options.cwd;
    this.shellPath = options.shellPath;
    this.shellEnv = options.shellEnv;
    this.watchOptions = options.watch ?? {};
  }

  private at(path: string, context: chordTypes.Context): nodeFilesTypes.FileRequest {
    return { context, path: resolvePath(this.cwd, path) };
  }

  watch(
    targets: readonly envTypes.WatchTarget[],
    onChange: (change: envTypes.WatchChange) => void,
    context: chordTypes.Context,
  ): Promise<envTypes.Result<envTypes.FileWatcher, envTypes.FileError>> {
    const aborted = abortResult<envTypes.FileWatcher>(context.abortSignal, undefined);
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
      const afterOpenAbort = abortResult<envTypes.FileWatcher>(context.abortSignal, undefined);
      if (afterOpenAbort === undefined)
        return ok<envTypes.FileWatcher, envTypes.FileError>(watcher);
      yield* Effect.promise(() => watcher.close(context));
      return afterOpenAbort;
    });
    return Effect.runPromise(recoverFileError(opening, undefined));
  }

  absolutePath(
    path: string,
    _context: chordTypes.Context,
  ): Promise<envTypes.Result<string, envTypes.FileError>> {
    return Promise.resolve(ok(resolvePath(this.cwd, path)));
  }

  joinPath(
    parts: string[],
    _context: chordTypes.Context,
  ): Promise<envTypes.Result<string, envTypes.FileError>> {
    return Promise.resolve(ok(joinPaths(...parts)));
  }

  exec(
    command: string | readonly string[],
    options: envTypes.ShellExecOptions | undefined,
    context: chordTypes.Context,
  ): Promise<envTypes.Result<envTypes.ShellExecResult, envTypes.ExecutionError>> {
    return execute({
      command,
      context,
      options,
      target: {
        activeChildPids: this.activeChildPids,
        createTempFile: Effect.promise(() =>
          this.createTempFile({ prefix: "msa-output-", suffix: ".log" }, context),
        ),
        cwd: this.cwd,
        shellEnv: this.shellEnv,
        shellPath: this.shellPath,
      },
    });
  }

  openTextLineReader(
    path: string,
    context: chordTypes.Context,
  ): Promise<envTypes.Result<envTypes.TextLineReader, envTypes.FileError>> {
    return nodeHandles.openTextLineReader(this.at(path, context));
  }

  readTextFile(
    path: string,
    context: chordTypes.Context,
  ): Promise<envTypes.Result<string, envTypes.FileError>> {
    return nodeFiles.readTextFile(this.at(path, context));
  }

  readTextLines(
    path: string,
    options: { maxLines?: number } | undefined,
    context: chordTypes.Context,
  ): Promise<envTypes.Result<string[], envTypes.FileError>> {
    const maxLines = options?.maxLines;
    if (maxLines !== undefined && maxLines <= 0) return Promise.resolve(ok([]));
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        const opened = yield* Effect.promise(() => this.openTextLineReader(path, context));
        if (!opened.ok) return err<string[], envTypes.FileError>(opened.error);
        const reader = opened.value;
        return yield* readLines(reader, maxLines, context).pipe(
          Effect.ensuring(Effect.promise(() => reader.close(context))),
        );
      }),
    );
  }

  readBinaryFile(
    path: string,
    context: chordTypes.Context,
  ): Promise<envTypes.Result<Uint8Array, envTypes.FileError>> {
    return nodeFiles.readBinaryFile(this.at(path, context));
  }

  openBinaryReader(
    path: string,
    options: { noFollow?: boolean } | undefined,
    context: chordTypes.Context,
  ): Promise<envTypes.Result<envTypes.BinaryReader, envTypes.FileError>> {
    const noFollow = options?.noFollow === true;
    return nodeHandles.openBinaryReader({ ...this.at(path, context), noFollow });
  }

  writeFile(
    path: string,
    content: string | Uint8Array,
    context: chordTypes.Context,
  ): Promise<envTypes.Result<void, envTypes.FileError>> {
    return nodeFiles.writeFile({ ...this.at(path, context), content });
  }

  appendFile(
    path: string,
    content: string | Uint8Array,
    context: chordTypes.Context,
  ): Promise<envTypes.Result<void, envTypes.FileError>> {
    return nodeFiles.appendFile({ ...this.at(path, context), content });
  }

  truncateFile(
    path: string,
    size: number,
    context: chordTypes.Context,
  ): Promise<envTypes.Result<void, envTypes.FileError>> {
    return nodeFiles.truncateFile({ ...this.at(path, context), size });
  }

  flushFile(
    path: string,
    context: chordTypes.Context,
  ): Promise<envTypes.Result<void, envTypes.FileError>> {
    return nodeHandles.flushFile(this.at(path, context));
  }

  renameFile(
    sourcePath: string,
    destinationPath: string,
    context: chordTypes.Context,
  ): Promise<envTypes.Result<void, envTypes.FileError>> {
    const source = resolvePath(this.cwd, sourcePath);
    return nodeFiles.renameFile({ ...this.at(destinationPath, context), source });
  }

  fileInfo(
    path: string,
    context: chordTypes.Context,
  ): Promise<envTypes.Result<envTypes.FileInfo, envTypes.FileError>> {
    return nodeHandles.fileInfo(this.at(path, context));
  }

  listDir(
    path: string,
    context: chordTypes.Context,
  ): Promise<envTypes.Result<envTypes.FileInfo[], envTypes.FileError>> {
    return nodeHandles.listDir(this.at(path, context));
  }

  openDirReader(
    path: string,
    context: chordTypes.Context,
  ): Promise<envTypes.Result<envTypes.DirReader, envTypes.FileError>> {
    return nodeHandles.openDirReader(this.at(path, context));
  }

  canonicalPath(
    path: string,
    context: chordTypes.Context,
  ): Promise<envTypes.Result<string, envTypes.FileError>> {
    return nodeFiles.canonicalPath(this.at(path, context));
  }

  exists(
    path: string,
    context: chordTypes.Context,
  ): Promise<envTypes.Result<boolean, envTypes.FileError>> {
    return this.fileInfo(path, context).then((result) => {
      if (result.ok) return ok(true);
      return result.error.code === "not_found" ? ok(false) : err(result.error);
    });
  }

  createDir(
    path: string,
    options: { recursive?: boolean } | undefined,
    context: chordTypes.Context,
  ): Promise<envTypes.Result<void, envTypes.FileError>> {
    const recursive = options?.recursive ?? true;
    return nodeFiles.createDir({ ...this.at(path, context), recursive });
  }

  remove(
    path: string,
    options: { recursive?: boolean; force?: boolean } | undefined,
    context: chordTypes.Context,
  ): Promise<envTypes.Result<void, envTypes.FileError>> {
    const recursive = options?.recursive ?? false;
    const force = options?.force ?? false;
    return nodeFiles.removePath({ ...this.at(path, context), force, recursive });
  }

  createTempDir(
    prefix: string | undefined,
    context: chordTypes.Context,
  ): Promise<envTypes.Result<string, envTypes.FileError>> {
    return nodeFiles.createTempDir({ context, prefix: prefix ?? "tmp-" });
  }

  createTempFile(
    options: { prefix?: string; suffix?: string } | undefined,
    context: chordTypes.Context,
  ): Promise<envTypes.Result<string, envTypes.FileError>> {
    return this.createTempDir("tmp-", context).then((directory) =>
      directory.ok
        ? nodeFiles.createEmptyTempFile({
            directory: directory.value,
            prefix: options?.prefix ?? "",
            suffix: options?.suffix ?? "",
          })
        : directory,
    );
  }

  cleanup(_context: chordTypes.Context): Promise<void> {
    for (const pid of this.activeChildPids) killProcessTree(pid);
    this.activeChildPids.clear();
    return Promise.resolve();
  }
}
