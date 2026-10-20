import * as Data from "effect/Data";

export default class RuntimeError extends Data.TaggedError("CodemodeRuntimeError")<{
  readonly reason: "bridge" | "launch" | "tool" | "remote";
  readonly message: string;
  readonly cause?: unknown;
}> {}
