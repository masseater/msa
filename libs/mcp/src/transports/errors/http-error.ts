import { Data } from "effect";

export class McpHttpError extends Data.TaggedError("McpHttpError")<{
  readonly status: number;
  readonly message: string;
  readonly body: string;
}> {
  constructor(status: number, message: string, body = "") {
    super({ status, message, body });
  }
}
