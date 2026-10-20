import { Data } from "effect";

import type fileErrorTypes from "./file-error.types.ts";

export default class FileError extends Data.TaggedError("FileError")<{
  readonly code: fileErrorTypes.FileErrorCode;
  readonly message: string;
  readonly path?: string | undefined;
  readonly cause?: Error;
}> {
  constructor(code: fileErrorTypes.FileErrorCode, message: string, path?: string, cause?: Error) {
    super({ code, message, path, ...(cause === undefined ? {} : { cause }) });
  }
}
