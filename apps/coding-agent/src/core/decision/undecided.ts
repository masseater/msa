import { Data } from "effect";

export default class Undecided extends Data.TaggedError("Undecided")<{
  readonly reason: string;
}> {}
