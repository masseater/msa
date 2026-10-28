import { Schema } from "effect";

export default class SshError extends Schema.TaggedError<
  SshError,
  { readonly brand: unique symbol }
>()("SshError", {
  exitCode: Schema.NullOr(Schema.Finite),
  message: Schema.String,
  stderr: Schema.String,
}) {
  static create(message: string, exitCode: number | null, stderr: string): SshError {
    return SshError.make({ exitCode, message, stderr });
  }
}
