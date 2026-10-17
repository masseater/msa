import { Data } from "effect";

export class OAuthRegistrationError extends Data.TaggedError("OAuthRegistrationError")<{
  readonly status: number;
  readonly body: string;
  readonly message: string;
}> {
  constructor(status: number, body: string) {
    super({
      status,
      body,
      message: `OAuth dynamic client registration failed with status ${status}: ${body}`,
    });
  }
}
