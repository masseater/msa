import { Data } from "effect";

export default class McpTimeoutError extends Data.TaggedError("McpTimeoutError")<{
  readonly timeoutMs: number;
  readonly message: string;
}> {
  constructor(timeoutMs: number) {
    super({ message: `MCP request timed out after ${timeoutMs}ms`, timeoutMs });
  }
}
