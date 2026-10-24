import { Schema } from "effect";

export default class OAuthError extends Schema.TaggedError<
  OAuthError,
  { readonly brand: unique symbol }
>()("OAuthError", {
  code: Schema.String,
  errorUri: Schema.UndefinedOr(Schema.String),
  message: Schema.String,
}) {
  static create(code: string, message: string, errorUri?: string): OAuthError {
    return OAuthError.make({ code, errorUri, message: message.length > 0 ? message : code });
  }
}
