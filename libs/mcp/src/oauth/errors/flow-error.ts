import { Data } from "effect";

export class OAuthFlowError extends Data.TaggedError("OAuthFlowError")<{
  readonly message: string;
}> {
  constructor(message: string) {
    super({ message });
  }
}
