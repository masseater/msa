import { Schema } from "effect";

export default class McpAbortError extends Schema.TaggedError<
  McpAbortError,
  { readonly brand: unique symbol }
>()("McpAbortError", { message: Schema.String }) {
  override readonly name = "AbortError";

  static create(message = "MCP request aborted"): McpAbortError {
    return McpAbortError.make({ message });
  }
}
