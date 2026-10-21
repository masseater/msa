import { Data } from "effect";

export default class McpAbortError extends Data.TaggedError("McpAbortError")<{
  readonly message: string;
}> {
  override readonly name = "AbortError";

  constructor(message = "MCP request aborted") {
    super({ message });
  }
}
