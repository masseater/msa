import { Data } from "effect";

export default class TaskStopped extends Data.TaggedError("TaskStopped")<{
  readonly message: string;
}> {}
