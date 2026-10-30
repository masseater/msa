import { DateTime, Effect } from "effect";

import type runtimeTypes from "./runtime.types.ts";

const nowMillis: Effect.Effect<number> = Effect.map(DateTime.now, DateTime.toEpochMillis);

function releaseThread(runtime: runtimeTypes.Runtime, threadId: string): void {
  const worker = runtime.workers.get(threadId);
  if (worker === undefined) return;
  runtime.launch(Effect.promise(() => worker.integrations.prWatch.close().catch(() => undefined)));
}

function abortThread(runtime: runtimeTypes.Runtime, threadId: string): void {
  const worker = runtime.workers.get(threadId);
  runtime.endRun(threadId);
  runtime.activity.delete(threadId);
  runtime.wrapUps.delete(threadId);
  releaseThread(runtime, threadId);
  if (worker !== undefined)
    runtime.launch(Effect.promise(() => worker.run.lifecycle.abort().catch(() => undefined)));
}

const runtime = {
  abortThread,
  nowMillis,
  releaseThread,
};

export default runtime;
