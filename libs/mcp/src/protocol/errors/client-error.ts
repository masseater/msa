import { Schema } from "effect";

export default class McpClientError extends Schema.TaggedError<
  McpClientError,
  { readonly brand: unique symbol }
>()("McpClientError", { message: Schema.String }) {
  static create(message: string): McpClientError {
    return McpClientError.make({ message });
  }
}
