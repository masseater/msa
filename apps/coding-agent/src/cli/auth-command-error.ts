import { Data } from "effect";

export default class AuthCommandError extends Data.TaggedError("AuthCommandError")<{
  readonly message: string;
}> {
  constructor(message: string) {
    super({ message });
  }
}
