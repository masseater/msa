import { Schema } from "effect";

export default class ReadAfterWrite extends Schema.TaggedError<
  ReadAfterWrite,
  { readonly brand: unique symbol }
>()("ReadAfterWrite", { message: Schema.String }) {
  static create(method: string): ReadAfterWrite {
    return ReadAfterWrite.make({
      message: `Tx.${method}() cannot read tables after the first table write`,
    });
  }
}
