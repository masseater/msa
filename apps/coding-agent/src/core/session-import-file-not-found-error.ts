import * as Schema from "effect/Schema";

export default class SessionImportFileNotFoundError extends Schema.TaggedError<
  SessionImportFileNotFoundError,
  { readonly brand: unique symbol }
>()("SessionImportFileNotFoundError", { filePath: Schema.String, message: Schema.String }) {
  static create(filePath: string): SessionImportFileNotFoundError {
    return SessionImportFileNotFoundError.make({
      filePath,
      message: `File not found: ${filePath}`,
    });
  }
}
