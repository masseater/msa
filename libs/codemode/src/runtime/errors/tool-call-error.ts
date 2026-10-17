import * as Data from "effect/Data";

export class ToolCallError extends Data.TaggedError("ToolCallError")<{ readonly message: string }> {
  constructor(message: string) {
    super({ message });
  }
}
