import { Schema } from "effect";

export default class AuthCommandError extends Schema.TaggedError<
  AuthCommandError,
  { readonly brand: unique symbol }
>()("AuthCommandError", { message: Schema.String }) {
  static create(message: string): AuthCommandError {
    return AuthCommandError.make({ message });
  }
}
