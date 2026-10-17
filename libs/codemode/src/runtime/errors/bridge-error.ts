import * as Data from "effect/Data";

export class BridgeError extends Data.TaggedError("BridgeError")<{ readonly message: string }> {
  constructor(message: string) {
    super({ message });
  }
}
