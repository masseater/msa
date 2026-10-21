import { Data } from "effect";

export default class SshError extends Data.TaggedError("SshError")<{ readonly message: string }> {}
