import { Schema } from "effect";

export default class McpTimeoutError extends Schema.TaggedError<
  McpTimeoutError,
  { readonly brand: unique symbol }
>()("McpTimeoutError", { message: Schema.String, timeoutMs: Schema.Finite }) {
  static create(timeoutMs: number): McpTimeoutError {
    return McpTimeoutError.make({
      message: `MCP request timed out after ${timeoutMs}ms`,
      timeoutMs,
    });
  }
}
