import { Data } from "effect";

export default class D extends Data.TaggedError("D")<{ readonly message: string }> {}
