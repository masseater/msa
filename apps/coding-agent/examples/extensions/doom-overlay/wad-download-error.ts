import { Schema } from "effect";

export default class WadDownloadError extends Schema.TaggedError<
  WadDownloadError,
  { readonly brand: unique symbol }
>()("WadDownloadError", { message: Schema.String }) {}
