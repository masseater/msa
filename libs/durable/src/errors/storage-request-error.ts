import { Data } from "effect";

export default class StorageRequestError extends Data.TaggedError("StorageRequestError")<{
  readonly message: string;
}> {
  constructor(message: string) {
    super({ message });
  }
}
