import { Schema } from "effect";

export default class McpConnectionClosedError extends Schema.TaggedError<
  McpConnectionClosedError,
  { readonly brand: unique symbol }
>()("McpConnectionClosedError", { message: Schema.String }) {
  static create(message = "MCP connection closed"): McpConnectionClosedError {
    return McpConnectionClosedError.make({ message });
  }
}
