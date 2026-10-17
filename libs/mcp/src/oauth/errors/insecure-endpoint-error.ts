import { Data } from "effect";

export class OAuthInsecureEndpointError extends Data.TaggedError("OAuthInsecureEndpointError")<{
  readonly endpoint: string;
  readonly message: string;
}> {
  constructor(endpoint: string) {
    super({
      endpoint,
      message: `Refusing to send OAuth credentials to non-HTTPS endpoint ${endpoint}`,
    });
  }
}
