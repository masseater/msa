import { Data } from "effect";

export class SetupError extends Data.Error<{ readonly message: string }> {
  constructor(message: string) {
    super({ message });
  }
}
