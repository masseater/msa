import { Schema } from "effect";

import type fileErrorTypes from "./file-error.types.ts";

export default class FileError extends Schema.TaggedError<
  FileError,
  { readonly brand: unique symbol }
>()("FileError", {
  cause: Schema.optionalKey(Schema.instanceOf(Error)),
  code: Schema.Literals([
    "aborted",
    "not_found",
    "permission_denied",
    "not_directory",
    "is_directory",
    "invalid",
    "not_supported",
    "unknown",
  ]),
  message: Schema.String,
  path: Schema.optional(Schema.String),
}) {
  static create(
    code: fileErrorTypes.FileErrorCode,
    message: string,
    path?: string,
    cause?: Error,
  ): FileError {
    return FileError.make({ code, message, path, ...(cause === undefined ? {} : { cause }) });
  }
}
