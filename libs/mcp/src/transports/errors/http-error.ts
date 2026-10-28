import { Schema } from "effect";

export default class McpHttpError extends Schema.TaggedError<
  McpHttpError,
  { readonly brand: unique symbol }
>()("McpHttpError", { body: Schema.String, message: Schema.String, status: Schema.Finite }) {
  static create(status: number, message: string, body = ""): McpHttpError {
    return McpHttpError.make({ body, message, status });
  }
}
