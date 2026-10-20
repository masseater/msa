import { Data } from "effect";

class HostKeyChangedError extends Data.TaggedError("HostKeyChangedError")<{
  readonly message: string;
}> {
  constructor(message: string) {
    super({ message });
  }
}

const hostKeyChangedError = {
  HostKeyChangedError,
};

export default hostKeyChangedError;
