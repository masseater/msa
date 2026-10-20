import { Data } from "effect";

export default class McpTransportError extends Data.TaggedError("McpTransportError")<{
  readonly message: string;
}> {
  constructor(message: string) {
    super({ message });
  }
}
