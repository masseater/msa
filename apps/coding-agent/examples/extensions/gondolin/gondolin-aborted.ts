import { Data } from "effect";

export default class GondolinAborted extends Data.TaggedError("GondolinAborted")<{
  readonly message: string;
}> {}
