import { Data } from "effect";

export default class McpConnectionClosedError extends Data.TaggedError("McpConnectionClosedError")<{
  readonly message: string;
}> {
  constructor(message = "MCP connection closed") {
    super({ message });
  }
}
