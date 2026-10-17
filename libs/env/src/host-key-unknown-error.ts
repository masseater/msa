import { Data } from "effect";

export class HostKeyUnknownError extends Data.TaggedError("HostKeyUnknownError")<{
  readonly message: string;
}> {
  constructor(message: string) {
    super({ message });
  }
}
