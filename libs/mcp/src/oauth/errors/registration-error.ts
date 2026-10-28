import { Schema } from "effect";

export default class OAuthRegistrationError extends Schema.TaggedError<
  OAuthRegistrationError,
  { readonly brand: unique symbol }
>()("OAuthRegistrationError", {
  body: Schema.String,
  message: Schema.String,
  status: Schema.Finite,
}) {
  static create(status: number, body: string): OAuthRegistrationError {
    return OAuthRegistrationError.make({
      body,
      message: `OAuth dynamic client registration failed with status ${status}: ${body}`,
      status,
    });
  }
}
