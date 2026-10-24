import { Schema } from "effect";

export default class GitLabAuthError extends Schema.TaggedError<
  GitLabAuthError,
  { readonly brand: unique symbol }
>()("GitLabAuthError", { message: Schema.String }) {}
