import { Schema } from "effect";

export default class DownloadDisabledError extends Schema.TaggedError<
  DownloadDisabledError,
  { readonly brand: unique symbol }
>()("DownloadDisabledError", { cause: Schema.instanceOf(Error) }) {}
