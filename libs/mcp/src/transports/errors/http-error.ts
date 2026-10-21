import { Data } from "effect";

export default class McpHttpError extends Data.TaggedError("McpHttpError")<{
  readonly status: number;
  readonly message: string;
  readonly body: string;
}> {
  constructor(status: number, message: string, body = "") {
    super({ body, message, status });
  }
}
