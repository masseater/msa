import { Data } from "effect";

export default class McpForeignError extends Data.TaggedError("McpForeignError")<{
  readonly cause: unknown;
  readonly message: string;
}> {}
