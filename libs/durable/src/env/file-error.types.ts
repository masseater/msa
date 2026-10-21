import type FileErrorClass from "./file-error.ts";

declare namespace fileErrorTypes {
  type FileErrorCode =
    | "aborted"
    | "not_found"
    | "permission_denied"
    | "not_directory"
    | "is_directory"
    | "invalid"
    | "not_supported"
    | "unknown";

  type FileError = FileErrorClass;
}

export type { fileErrorTypes as default };
