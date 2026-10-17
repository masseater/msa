import { Data } from "effect";

const formatIssuer = (issuer: string | undefined): string =>
  issuer === undefined ? "none" : JSON.stringify(issuer);

export class OAuthIssuerMismatchError extends Data.TaggedError("OAuthIssuerMismatchError")<{
  readonly expected: string | undefined;
  readonly received: string | undefined;
  readonly message: string;
}> {
  constructor(expected: string | undefined, received: string | undefined) {
    super({
      expected,
      received,
      message: `OAuth issuer mismatch: expected ${formatIssuer(expected)}, received ${formatIssuer(received)}`,
    });
  }
}
