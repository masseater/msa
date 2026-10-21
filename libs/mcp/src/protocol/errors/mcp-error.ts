import { Data } from "effect";

export default class McpError extends Data.TaggedError("McpError")<{
  readonly code: number;
  readonly message: string;
  readonly data: unknown;
}> {
  constructor(code: number, message: string, data?: unknown) {
    super({ code, data, message });
  }
}
