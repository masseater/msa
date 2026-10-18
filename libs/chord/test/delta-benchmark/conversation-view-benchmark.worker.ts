import { Console, Effect } from "effect";

import { collectGarbage, encodeJson } from "../fixtures/benchmark.ts";
import { ConversationViewRun } from "./conversation-view-run.ts";
import { MiB, parseWorkerArguments } from "./conversation-view-types.ts";

const args = parseWorkerArguments(process.argv);

const settledHeap = Effect.andThen(
  collectGarbage(3),
  Effect.sync(() => process.memoryUsage().heapUsed),
);

const main = Effect.gen(function* () {
  const processBaselineHeap = yield* settledHeap;
  const run = new ConversationViewRun(args);
  const baselineHeap = yield* settledHeap;
  const retainedMiB = (heap: number) => (heap - baselineHeap) / MiB;
  yield* run.acquireInitialWatches();
  const postAcquireRetainedMiB = retainedMiB(yield* settledHeap);
  run.samplePeak();
  for (let index = 0; index < args.commitTarget; index++) {
    yield* run.commit(index);
    yield* run.reconnect(index);
  }
  const postWorkRetainedMiB = retainedMiB(yield* settledHeap);
  run.samplePeak();
  yield* run.verify();
  const postVerificationRetainedMiB = retainedMiB(yield* settledHeap);
  const final = run.finalQueues();
  run.releaseQueues();
  const releasedHeap = yield* settledHeap;
  const line = yield* encodeJson({
    ...run.identity(),
    ...run.counters(final),
    authorityReadyMiB: (baselineHeap - processBaselineHeap) / MiB,
    postAcquireRetainedMiB,
    postWorkRetainedMiB,
    postVerificationRetainedMiB,
    releaseHeapMiB: retainedMiB(releasedHeap),
    releaseTotalMiB: (releasedHeap - processBaselineHeap) / MiB,
    peakHeapMiB: retainedMiB(run.peakHeap),
    peakTotalHeapMiB: (run.peakHeap - processBaselineHeap) / MiB,
    maxRssMiB: process.resourceUsage().maxRSS / 1024,
    checksum: run.checksum(),
  });
  yield* Console.log(line);
});

await Effect.runPromise(main);
