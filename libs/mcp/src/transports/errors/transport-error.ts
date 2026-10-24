import { Schema } from "effect";

export default class McpTransportError extends Schema.TaggedError<
  McpTransportError,
  { readonly brand: unique symbol }
>()("McpTransportError", { message: Schema.String }) {
  static create(message: string): McpTransportError {
    return McpTransportError.make({ message });
  }
}
