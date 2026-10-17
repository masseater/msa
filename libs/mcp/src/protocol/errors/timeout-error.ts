import { Data } from "effect";

export class McpTimeoutError extends Data.TaggedError("McpTimeoutError")<{
  readonly timeoutMs: number;
  readonly message: string;
}> {
  constructor(timeoutMs: number) {
    super({ timeoutMs, message: `MCP request timed out after ${timeoutMs}ms` });
  }
}
