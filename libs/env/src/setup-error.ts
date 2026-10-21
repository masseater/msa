import { Data } from "effect";

export default class SetupError extends Data.Error<{ readonly message: string }> {
  constructor(message: string) {
    super({ message });
  }
}
