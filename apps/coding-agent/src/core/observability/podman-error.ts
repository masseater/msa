import { Data } from "effect";

export default class PodmanError extends Data.TaggedError("PodmanError")<{
  readonly message: string;
}> {}
