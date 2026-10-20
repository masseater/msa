import { Data } from "effect";

export default class HostKeyUnknownError extends Data.TaggedError("HostKeyUnknownError")<{
  readonly message: string;
}> {
  constructor(message: string) {
    super({ message });
  }
}
