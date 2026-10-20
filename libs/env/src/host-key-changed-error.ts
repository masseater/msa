import { Data } from "effect";

export default class HostKeyChangedError extends Data.TaggedError("HostKeyChangedError")<{
  readonly message: string;
}> {
  constructor(message: string) {
    super({ message });
  }
}
