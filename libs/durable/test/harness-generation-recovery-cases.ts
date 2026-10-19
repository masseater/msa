import { type Harness, LiveDoc, type TaskId } from "@msa/durable";
import { Effect } from "effect";

import { awaited, context } from "./support.ts";

export const runTaskId = Effect.fn("runTaskId")(function* (harness: Harness) {
  const live = yield* awaited(harness.snapshot(LiveDoc, 1 as never, context));
  return live!.run!.taskId;
});

export const checkpoint = Effect.fn("checkpoint")(function* (harness: Harness, id: TaskId) {
  const record = yield* awaited(harness.getTask(id, context));
  return record?.state.status === "terminal" ? undefined : record?.state.checkpoint;
});
