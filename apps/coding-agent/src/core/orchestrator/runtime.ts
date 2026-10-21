import { DateTime, Effect } from "effect";

import type runtimeTypes from "./runtime.types.ts";

const nowMillis: Effect.Effect<number> = Effect.map(DateTime.now, DateTime.toEpochMillis);

function releaseThread(runtime: runtimeTypes.Runtime, threadId: string): void {
  const worker = runtime.workers.get(threadId);
  if (worker === undefined) return;
  void worker.integrations.prWatch.close().catch(() => undefined);
}

const runtime = {
  nowMillis,
  releaseThread,
};

export default runtime;
