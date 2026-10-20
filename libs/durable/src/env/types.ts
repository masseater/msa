import type { Context } from "@msa/chord";

import type executionErrorTypes from "./execution-error.types.ts";
import type fileErrorTypes from "./file-error.types.ts";
import type resultTypes from "./result.types.ts";

declare namespace typesModule {
  type FileKind = "file" | "directory" | "symlink";

  interface FileInfo {
    name: string;
    path: string;
    kind: FileKind;
    size: number;
    mtimeMs: number;
  }

  interface TextLine {
    text: string;
    terminated: boolean;
  }

  interface TextLineReader {
    readLine(
      context: Context,
    ): Promise<resultTypes.Result<TextLine | undefined, fileErrorTypes.FileError>>;
    close(context: Context): Promise<void>;
  }

  interface BinaryReader {
    info(context: Context): Promise<resultTypes.Result<FileInfo, fileErrorTypes.FileError>>;
    read(
      offset: number,
      length: number,
      context: Context,
    ): Promise<resultTypes.Result<Uint8Array, fileErrorTypes.FileError>>;
    scanLines(
      options: { startLine: number; endLine?: number },
      context: Context,
    ): Promise<resultTypes.Result<LineScan, fileErrorTypes.FileError>>;
    close(context: Context): Promise<void>;
  }

  interface WatchTarget {
    path: string;
    recursive?: boolean;
    exclude?: { hidden?: boolean; names?: readonly string[] };
  }

  type WatchChange = { paths: string[] } | { overflow: true } | { error: fileErrorTypes.FileError };

  interface FileWatcher {
    readonly mode: "native" | "polling";
    close(context: Context): Promise<void>;
  }

  interface LineScan {
    newlines: number;
    start: number;
    end: number;
    firstLineEnd: number;
    lastLineStart: number;
    selectedBytes: number;
    firstLineBytes: number;
  }

  interface DirReader {
    next(
      maxEntries: number,
      context: Context,
    ): Promise<
      resultTypes.Result<{ entries: FileInfo[]; done: boolean }, fileErrorTypes.FileError>
    >;
    close(context: Context): Promise<void>;
  }

  interface ListFilesOptions {
    hidden?: boolean;
    gitignore?: boolean;
    exclude?: readonly string[];
    maxEntries?: number;
    maxBytes?: number;
    timeoutMs?: number;
  }

  interface FileListEntry {
    path: string;
    kind: FileKind;
  }

  interface FileListing {
    entries: FileListEntry[];
    truncated: boolean;
  }

  interface FileSystem {
    readonly id: string;
    cwd: string;
    absolutePath(
      path: string,
      context: Context,
    ): Promise<resultTypes.Result<string, fileErrorTypes.FileError>>;
    joinPath(
      parts: string[],
      context: Context,
    ): Promise<resultTypes.Result<string, fileErrorTypes.FileError>>;
    readTextFile(
      path: string,
      context: Context,
    ): Promise<resultTypes.Result<string, fileErrorTypes.FileError>>;
    openTextLineReader(
      path: string,
      context: Context,
    ): Promise<resultTypes.Result<TextLineReader, fileErrorTypes.FileError>>;
    readTextLines(
      path: string,
      options: { maxLines?: number } | undefined,
      context: Context,
    ): Promise<resultTypes.Result<string[], fileErrorTypes.FileError>>;
    readBinaryFile(
      path: string,
      context: Context,
    ): Promise<resultTypes.Result<Uint8Array, fileErrorTypes.FileError>>;
    openBinaryReader(
      path: string,
      options: { noFollow?: boolean } | undefined,
      context: Context,
    ): Promise<resultTypes.Result<BinaryReader, fileErrorTypes.FileError>>;
    writeFile(
      path: string,
      content: string | Uint8Array,
      context: Context,
    ): Promise<resultTypes.Result<void, fileErrorTypes.FileError>>;
    appendFile(
      path: string,
      content: string | Uint8Array,
      context: Context,
    ): Promise<resultTypes.Result<void, fileErrorTypes.FileError>>;
    truncateFile(
      path: string,
      size: number,
      context: Context,
    ): Promise<resultTypes.Result<void, fileErrorTypes.FileError>>;
    flushFile(
      path: string,
      context: Context,
    ): Promise<resultTypes.Result<void, fileErrorTypes.FileError>>;
    renameFile(
      sourcePath: string,
      destinationPath: string,
      context: Context,
    ): Promise<resultTypes.Result<void, fileErrorTypes.FileError>>;
    fileInfo(
      path: string,
      context: Context,
    ): Promise<resultTypes.Result<FileInfo, fileErrorTypes.FileError>>;
    listDir(
      path: string,
      context: Context,
    ): Promise<resultTypes.Result<FileInfo[], fileErrorTypes.FileError>>;
    listFiles?(
      path: string,
      options: ListFilesOptions | undefined,
      context: Context,
    ): Promise<resultTypes.Result<FileListing, fileErrorTypes.FileError>>;
    openDirReader(
      path: string,
      context: Context,
    ): Promise<resultTypes.Result<DirReader, fileErrorTypes.FileError>>;
    watch(
      targets: readonly WatchTarget[],
      onChange: (change: WatchChange) => void,
      context: Context,
    ): Promise<resultTypes.Result<FileWatcher, fileErrorTypes.FileError>>;
    canonicalPath(
      path: string,
      context: Context,
    ): Promise<resultTypes.Result<string, fileErrorTypes.FileError>>;
    exists(
      path: string,
      context: Context,
    ): Promise<resultTypes.Result<boolean, fileErrorTypes.FileError>>;
    createDir(
      path: string,
      options: { recursive?: boolean } | undefined,
      context: Context,
    ): Promise<resultTypes.Result<void, fileErrorTypes.FileError>>;
    remove(
      path: string,
      options: { recursive?: boolean; force?: boolean } | undefined,
      context: Context,
    ): Promise<resultTypes.Result<void, fileErrorTypes.FileError>>;
    createTempDir(
      prefix: string | undefined,
      context: Context,
    ): Promise<resultTypes.Result<string, fileErrorTypes.FileError>>;
    createTempFile(
      options: { prefix?: string; suffix?: string } | undefined,
      context: Context,
    ): Promise<resultTypes.Result<string, fileErrorTypes.FileError>>;
    cleanup(context: Context): Promise<void>;
  }

  interface ShellSpillOptions {
    afterBytes: number;
    afterLines: number;
  }

  interface ShellExecResult {
    exitCode: number;
    spillPath?: string;
  }

  interface ShellExecOptions {
    cwd?: string;
    env?: Record<string, string>;
    inheritEnv?: boolean;
    timeout?: number;
    onOutput?: (text: string, context: Context, info: ShellOutputInfo) => void;
    spill?: ShellSpillOptions;
    window?: ShellOutputWindow;
  }

  interface ShellOutputWindow {
    maxBytes: number;
    maxLines: number;
    minIntervalMs: number;
    bytesPerSecond: number;
  }

  interface ShellOutputSkip {
    bytes: number;
    newlines: number;
    endsWithNewline: boolean;
  }

  interface ShellOutputInfo {
    stream: "stdout" | "stderr";
    skipped?: ShellOutputSkip;
  }

  interface Shell {
    exec(
      command: string | readonly string[],
      options: ShellExecOptions | undefined,
      context: Context,
    ): Promise<resultTypes.Result<ShellExecResult, executionErrorTypes.ExecutionError>>;
    cleanup(context: Context): Promise<void>;
  }

  interface ExecutionEnv extends FileSystem, Shell {}
}

export type { typesModule as default };
