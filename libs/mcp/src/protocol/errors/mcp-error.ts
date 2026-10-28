import { Schema } from "effect";

export default class McpError extends Schema.TaggedError<
  McpError,
  { readonly brand: unique symbol }
>()("McpError", { code: Schema.Finite, data: Schema.Unknown, message: Schema.String }) {
  static create(code: number, message: string, data?: unknown): McpError {
    return McpError.make({ code, data, message });
  }
}
