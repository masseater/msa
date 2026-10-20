import { Data } from "effect";

class SetupError extends Data.Error<{ readonly message: string }> {
  constructor(message: string) {
    super({ message });
  }
}

const setupError = {
  SetupError,
};

export default setupError;
