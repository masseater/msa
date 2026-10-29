import { DateTime, Effect } from "effect";

import type runtimeTypes from "./runtime.types.ts";

const nowMillis: Effect.Effect<number> = Effect.map(DateTime.now, DateTime.toEpochMillis);

function releaseThread(runtime: runtimeTypes.Runtime, threadId: string): void {
  const worker = runtime.workers.get(threadId);
  if (worker === undefined) return;
  void worker.integrations.prWatch.close().catch(() => undefined);
}

function abortThread(runtime: runtimeTypes.Runtime, threadId: string): void {
  const worker = runtime.workers.get(threadId);
  runtime.runs.delete(threadId);
  runtime.runStartedAt.delete(threadId);
  runtime.activity.delete(threadId);
  runtime.wrapUps.delete(threadId);
  releaseThread(runtime, threadId);
  void worker?.run.lifecycle.abort().catch(() => undefined);
}

const runtime = {
  abortThread,
  nowMillis,
  releaseThread,
};

export default runtime;
