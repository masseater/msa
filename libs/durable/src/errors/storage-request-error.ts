import { Schema } from "effect";

export default class StorageRequestError extends Schema.TaggedError<
  StorageRequestError,
  { readonly brand: unique symbol }
>()("StorageRequestError", { message: Schema.String }) {
  static create(message: string): StorageRequestError {
    return StorageRequestError.make({ message });
  }
}
