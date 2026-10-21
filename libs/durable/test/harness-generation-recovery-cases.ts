import durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";

import support from "./support.ts";

const { LiveDoc } = durable;

const { awaited, context } = support;

const runTaskId = Effect.fn("runTaskId")(function* (harness: durableTypes.Harness) {
  const live = yield* awaited(harness.snapshot(LiveDoc, 1 as never, context));
  return live!.run!.taskId;
});

const checkpoint = Effect.fn("checkpoint")(function* (
  harness: durableTypes.Harness,
  id: durableTypes.TaskId,
) {
  const record = yield* awaited(harness.getTask(id, context));
  return record?.state.status === "terminal" ? undefined : record?.state.checkpoint;
});

const harnessGenerationRecoveryCases = {
  checkpoint,
  runTaskId,
};

export default harnessGenerationRecoveryCases;
