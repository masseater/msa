import { Data } from "effect";

export default class OAuthFlowError extends Data.TaggedError("OAuthFlowError")<{
  readonly message: string;
}> {
  constructor(message: string) {
    super({ message });
  }
}
