import { Data } from "effect";

export class McpError extends Data.TaggedError("McpError")<{
  readonly code: number;
  readonly message: string;
  readonly data: unknown;
}> {
  constructor(code: number, message: string, data?: unknown) {
    super({ code, message, data });
  }
}
