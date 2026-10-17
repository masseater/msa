import { Data } from "effect";

export class HostKeyChangedError extends Data.TaggedError("HostKeyChangedError")<{
  readonly message: string;
}> {
  constructor(message: string) {
    super({ message });
  }
}
