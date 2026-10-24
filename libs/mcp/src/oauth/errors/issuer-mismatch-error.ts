import { Schema } from "effect";

const formatIssuer = (issuer: string | undefined): string =>
  issuer === undefined ? "none" : JSON.stringify(issuer);

export default class OAuthIssuerMismatchError extends Schema.TaggedError<
  OAuthIssuerMismatchError,
  { readonly brand: unique symbol }
>()("OAuthIssuerMismatchError", {
  expected: Schema.UndefinedOr(Schema.String),
  message: Schema.String,
  received: Schema.UndefinedOr(Schema.String),
}) {
  static create(
    expected: string | undefined,
    received: string | undefined,
  ): OAuthIssuerMismatchError {
    return OAuthIssuerMismatchError.make({
      expected,
      message: `OAuth issuer mismatch: expected ${formatIssuer(expected)}, received ${formatIssuer(received)}`,
      received,
    });
  }
}
