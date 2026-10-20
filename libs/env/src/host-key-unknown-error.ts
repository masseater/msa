import { Data } from "effect";

class HostKeyUnknownError extends Data.TaggedError("HostKeyUnknownError")<{
  readonly message: string;
}> {
  constructor(message: string) {
    super({ message });
  }
}

const hostKeyUnknownError = {
  HostKeyUnknownError,
};

export default hostKeyUnknownError;
