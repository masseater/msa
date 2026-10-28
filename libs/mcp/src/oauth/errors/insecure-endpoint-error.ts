import { Schema } from "effect";

export default class OAuthInsecureEndpointError extends Schema.TaggedError<
  OAuthInsecureEndpointError,
  { readonly brand: unique symbol }
>()("OAuthInsecureEndpointError", { endpoint: Schema.String, message: Schema.String }) {
  static create(endpoint: string): OAuthInsecureEndpointError {
    return OAuthInsecureEndpointError.make({
      endpoint,
      message: `Refusing to send OAuth credentials to non-HTTPS endpoint ${endpoint}`,
    });
  }
}
