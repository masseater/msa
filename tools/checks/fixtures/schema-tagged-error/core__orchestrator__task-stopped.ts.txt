import { Predicate, Schema } from "effect";

export default class TaskStopped extends Schema.TaggedError<
  TaskStopped,
  { readonly brand: unique symbol }
>()("TaskStopped", { message: Schema.String }) {
  static isStopped(value: unknown): value is TaskStopped {
    return Predicate.isTagged(value, "TaskStopped");
  }
}
