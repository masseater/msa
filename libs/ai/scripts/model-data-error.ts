import { Data } from "effect";

export default class ModelDataError extends Data.TaggedError("ModelDataError")<{
  readonly message: string;
}> {}
