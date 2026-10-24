import { Schema } from "effect";

export default class HostKeyChangedError extends Schema.TaggedError<
  HostKeyChangedError,
  { readonly brand: unique symbol }
>()("HostKeyChangedError", { message: Schema.String }) {
  static create(message: string): HostKeyChangedError {
    return HostKeyChangedError.make({ message });
  }
}
