import { Data } from "effect";

export class McpClientError extends Data.TaggedError("McpClientError")<{
  readonly message: string;
}> {
  constructor(message: string) {
    super({ message });
  }
}
