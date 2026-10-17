import { Data } from "effect";

export type FileErrorCode =
  | "aborted"
  | "not_found"
  | "permission_denied"
  | "not_directory"
  | "is_directory"
  | "invalid"
  | "not_supported"
  | "unknown";

export class FileError extends Data.TaggedError("FileError")<{
  readonly code: FileErrorCode;
  readonly message: string;
  readonly path?: string | undefined;
  readonly cause?: Error;
}> {
  constructor(code: FileErrorCode, message: string, path?: string, cause?: Error) {
    super({ code, message, path, ...(cause === undefined ? {} : { cause }) });
  }
}
