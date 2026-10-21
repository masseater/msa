import { Data } from "effect";

export default class CodexStreamError extends Data.TaggedError("CodexStreamError")<{
  readonly message: string;
  readonly kind: "api" | "protocol" | "callback";
  readonly code?: string | undefined;
  readonly payload?: unknown;
  readonly cause?: unknown;
}> {}
