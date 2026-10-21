import { Data } from "effect";

export default class McpSignInCancelledError extends Data.TaggedError("McpSignInCancelledError")<{
  readonly message: string;
}> {
  constructor() {
    super({ message: "Sign-in cancelled" });
  }
}
