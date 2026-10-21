import type decodeTypes from "./decode.types.ts";
import type executionErrorTypes from "./execution-error.types.ts";
import type fileErrorTypes from "./file-error.types.ts";
import type lineScanTypes from "./line-scan.types.ts";
import type resultTypes from "./result.types.ts";
import type typesModule from "./types.ts";

declare namespace envTypes {
  type ExecutionErrorCode = executionErrorTypes.ExecutionErrorCode;

  type FileErrorCode = fileErrorTypes.FileErrorCode;

  type Result<TValue, TError> = resultTypes.Result<TValue, TError>;

  type FileKind = typesModule.FileKind;

  type FileInfo = typesModule.FileInfo;

  type TextLine = typesModule.TextLine;

  type TextLineReader = typesModule.TextLineReader;

  type BinaryReader = typesModule.BinaryReader;

  type WatchTarget = typesModule.WatchTarget;

  type WatchChange = typesModule.WatchChange;

  type FileWatcher = typesModule.FileWatcher;

  type LineScan = typesModule.LineScan;

  type DirReader = typesModule.DirReader;

  type ListFilesOptions = typesModule.ListFilesOptions;

  type FileListEntry = typesModule.FileListEntry;

  type FileListing = typesModule.FileListing;

  type FileSystem = typesModule.FileSystem;

  type ShellSpillOptions = typesModule.ShellSpillOptions;

  type ShellExecResult = typesModule.ShellExecResult;

  type ShellExecOptions = typesModule.ShellExecOptions;

  type ShellOutputWindow = typesModule.ShellOutputWindow;

  type ShellOutputSkip = typesModule.ShellOutputSkip;

  type ShellOutputInfo = typesModule.ShellOutputInfo;

  type Shell = typesModule.Shell;

  type ExecutionEnv = typesModule.ExecutionEnv;

  type ExecutionError = executionErrorTypes.ExecutionError;

  type FileError = fileErrorTypes.FileError;

  type StreamDecoder = decodeTypes.StreamDecoder;

  type LineScanner = lineScanTypes.LineScanner;
}

export type { envTypes as default };
