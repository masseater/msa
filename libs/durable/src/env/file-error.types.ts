import type FileErrorClass from "./file-error.ts";

declare namespace fileErrorTypes {
  type FileErrorCode = FileErrorClass["code"];

  type FileError = FileErrorClass;
}

export type { fileErrorTypes as default };
