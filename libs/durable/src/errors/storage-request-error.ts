import { Data } from "effect";

export class StorageRequestError extends Data.TaggedError("StorageRequestError")<{
  readonly message: string;
}> {
  constructor(message: string) {
    super({ message });
  }
}
