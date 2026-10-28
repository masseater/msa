import { Schema } from "effect";

export default class HostKeyUnknownError extends Schema.TaggedError<
  HostKeyUnknownError,
  { readonly brand: unique symbol }
>()("HostKeyUnknownError", { message: Schema.String }) {
  static create(message: string): HostKeyUnknownError {
    return HostKeyUnknownError.make({ message });
  }
}
