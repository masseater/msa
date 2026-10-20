import { Data } from "effect";

export default class ReadAfterWrite extends Data.TaggedError("ReadAfterWrite")<{
  readonly message: string;
}> {
  constructor(method: string) {
    super({ message: `Tx.${method}() cannot read tables after the first table write` });
  }
}
