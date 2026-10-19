import { Data } from "effect";

export class McpSignInCancelledError extends Data.TaggedError("McpSignInCancelledError")<{
  readonly message: string;
}> {
  constructor() {
    super({ message: "Sign-in cancelled" });
  }
}
