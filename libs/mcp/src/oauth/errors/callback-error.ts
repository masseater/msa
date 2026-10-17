import { Data } from "effect";

export class OAuthCallbackError extends Data.TaggedError("OAuthCallbackError")<{
  readonly message: string;
}> {
  constructor(message: string) {
    super({ message });
  }
}
