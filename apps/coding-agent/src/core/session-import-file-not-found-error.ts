import * as Data from "effect/Data";

export default class SessionImportFileNotFoundError extends Data.TaggedError(
  "SessionImportFileNotFoundError",
)<{
  readonly filePath: string;
  readonly message: string;
}> {
  constructor(filePath: string) {
    super({ filePath, message: `File not found: ${filePath}` });
  }
}
