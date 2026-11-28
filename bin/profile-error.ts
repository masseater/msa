import { Schema } from "effect";

export default class ProfileError extends Schema.TaggedError<
  ProfileError,
  { readonly brand: unique symbol }
>()("ProfileError", { message: Schema.String }) {}
