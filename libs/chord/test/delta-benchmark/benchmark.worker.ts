import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { Console, Effect } from "effect";

import { applyImmutable } from "../../src/delta/index.ts";
import { collectGarbage } from "../fixtures/benchmark.ts";
import {
  applyFrame,
  assertDetached,
  cloneTrusted,
  type Document,
  type Frame,
  importFixture,
  MiB,
  parseArguments,
  runMutationScenario,
  sum,
  WATCH_SCENARIOS,
  type WatchReplica,
} from "./benchmark-worker-model.ts";

const { mode, scenario, size, trial, requestedWatchCount, requestedWatchUpdates } = parseArguments(
  process.argv,
);

const gc = collectGarbage(3);

await Effect.runPromise(gc);
const baselineHeap = process.memoryUsage().heapUsed;
const { tracker, importMs } = importFixture(size, scenario);
await Effect.runPromise(gc);
const readyHeap = process.memoryUsage().heapUsed;
let peakHeap = readyHeap;
let mutateMs = 0;
let prepareMs = 0;
let serializeMs = 0;
let adoptMs = 0;
let acquireMs = 0;
let enqueueMs = 0;
let deliveryMs = 0;
let opBytes = 0;
let operationCount = 0;
let checksum = 0;
let authoritySequence = 0;
let postAcquireRetainedMiB = 0;
let postLagRetainedMiB = 0;
let postDeliveryRetainedMiB = 0;
let sampledAcquireMiB = 0;
const watchers: WatchReplica[] = [];
const borrowedListeners: Array<(value: Document, sequence: number) => number> = [];
const queueOperations = Math.min(size, 1_000);
const watchCount = WATCH_SCENARIOS.has(scenario) ? requestedWatchCount : 0;
const watchUpdateTarget = WATCH_SCENARIOS.has(scenario) ? requestedWatchUpdates : 0;

const samplePeak = (): void => {
  peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
};

const retainedFromBaseline = (): Promise<number> =>
  Effect.runPromise(Effect.map(gc, () => (process.memoryUsage().heapUsed - baselineHeap) / MiB));

const createWatch = (value: Document): WatchReplica => ({
  value,
  baseSequence: authoritySequence,
  sequence: authoritySequence,
  queue: [],
});

const timedAcquire = (acquire: () => void): void => {
  const beforeHeap = process.memoryUsage().heapUsed;
  const start = performance.now();
  acquire();
  acquireMs += performance.now() - start;
  sampledAcquireMiB = Math.max(
    sampledAcquireMiB,
    (process.memoryUsage().heapUsed - beforeHeap) / MiB,
  );
};

const acquireSharedWatches = (): void => {
  timedAcquire(() => {
    const base = tracker.value;
    watchers.push(...Array.from({ length: watchCount }, () => createWatch(base)));
  });
  for (const watcher of watchers) assert.equal(watcher.value, tracker.value);
  samplePeak();
};

const acquireDetachedWatches = (): void => {
  timedAcquire(() => {
    watchers.push(
      ...Array.from({ length: watchCount }, () => createWatch(cloneTrusted(tracker.value))),
    );
  });
  assertDetached(watchers, tracker.value);
  samplePeak();
};

const acquireOneWatch = (): void => {
  timedAcquire(() => {
    watchers.push(createWatch(tracker.value));
  });
  samplePeak();
};

const commitWatchUpdate = (update: number): Frame => {
  const change = tracker.beginChange();
  const row = ((update + 1) * 997) % size;
  const mutateStart = performance.now();
  change.state.rows[row]!.value = -update - 1;
  mutateMs += performance.now() - mutateStart;
  samplePeak();
  const prepareStart = performance.now();
  const prepared = change.prepare();
  prepareMs += performance.now() - prepareStart;
  samplePeak();
  const operations = prepared.ops;
  operationCount += operations.length;
  const adoptStart = performance.now();
  tracker.adopt(prepared);
  adoptMs += performance.now() - adoptStart;
  samplePeak();
  authoritySequence += 1;
  return { sequence: authoritySequence, ops: operations };
};

const enqueueFrame = (frame: Frame): void => {
  const start = performance.now();
  for (const watcher of watchers) {
    assert.equal(frame.sequence, watcher.sequence + watcher.queue.length + 1);
    watcher.queue.push(frame);
  }
  enqueueMs += performance.now() - start;
};

const drainWatchQueues = (measure: boolean): void => {
  const start = performance.now();
  for (const watcher of watchers) {
    for (const frame of watcher.queue) applyFrame(watcher, frame);
    watcher.queue.length = 0;
    samplePeak();
  }
  if (measure) deliveryMs += performance.now() - start;
};

const drainWatchQueuesCoalesced = (): void => {
  const start = performance.now();
  for (const watcher of watchers) {
    const operations = watcher.queue.flatMap((frame) => frame.ops);
    watcher.value = applyImmutable(watcher.value, operations);
    watcher.sequence = watcher.queue.at(-1)?.sequence ?? watcher.sequence;
    watcher.queue.length = 0;
    samplePeak();
  }
  deliveryMs += performance.now() - start;
};

const assertWatchConvergence = (): void => {
  for (const watcher of watchers) {
    assert.equal(watcher.sequence, authoritySequence);
    assert.deepEqual(watcher.value, tracker.value);
  }
};

if (scenario === "committed-read") {
  const start = performance.now();
  checksum = sum(tracker.value);
  mutateMs = performance.now() - start;
  samplePeak();
} else if (scenario === "watch-authority-control") {
  for (let update = 0; update < watchUpdateTarget; update++) commitWatchUpdate(update);
  postDeliveryRetainedMiB = await retainedFromBaseline();
  checksum = sum(tracker.value);
} else if (scenario === "watch-live-borrowed") {
  const start = performance.now();
  borrowedListeners.push(
    ...Array.from(
      { length: watchCount },
      () => (value: Document, sequence: number) => value.rows[0]!.value + sequence,
    ),
  );
  for (const listener of borrowedListeners) checksum += listener(tracker.value, authoritySequence);
  acquireMs = performance.now() - start;
  postAcquireRetainedMiB = await retainedFromBaseline();
  for (let update = 0; update < watchUpdateTarget; update++) {
    commitWatchUpdate(update);
    const deliveryStart = performance.now();
    for (const listener of borrowedListeners)
      checksum += listener(tracker.value, authoritySequence);
    deliveryMs += performance.now() - deliveryStart;
    samplePeak();
  }
  postDeliveryRetainedMiB = await retainedFromBaseline();
} else if (scenario === "watch-acquire-shared" || scenario === "watch-acquire-detached") {
  if (scenario === "watch-acquire-shared") acquireSharedWatches();
  else acquireDetachedWatches();
  postAcquireRetainedMiB = await retainedFromBaseline();
  checksum = sum(watchers[0]!.value) + watchers.length;
} else if (scenario === "watch-acquire-staggered") {
  for (let watcher = 0; watcher < watchCount; watcher++) {
    acquireOneWatch();
    if (watcher + 1 === watchCount) break;
    const frame = commitWatchUpdate(watcher);
    enqueueFrame(frame);
  }
  for (let watcher = 0; watcher < watchers.length; watcher++) {
    assert.equal(watchers[watcher]!.baseSequence, watcher);
    assert.equal(watchers[watcher]!.queue.length, watchCount - watcher - 1);
  }
  postAcquireRetainedMiB = await retainedFromBaseline();
  drainWatchQueues(false);
  assertWatchConvergence();
  postDeliveryRetainedMiB = await retainedFromBaseline();
  checksum = sum(watchers[0]!.value) + sum(watchers.at(-1)!.value);
} else if (
  scenario === "watch-lag" ||
  scenario === "watch-catch-up" ||
  scenario === "watch-catch-up-coalesced" ||
  scenario === "watch-live-immutable"
) {
  acquireSharedWatches();
  postAcquireRetainedMiB = await retainedFromBaseline();
  for (let update = 0; update < watchUpdateTarget; update++) {
    const frame = commitWatchUpdate(update);
    if (scenario === "watch-live-immutable") {
      const start = performance.now();
      for (const watcher of watchers) applyFrame(watcher, frame);
      deliveryMs += performance.now() - start;
      samplePeak();
    } else enqueueFrame(frame);
  }
  postLagRetainedMiB = await retainedFromBaseline();
  if (scenario === "watch-catch-up-coalesced") drainWatchQueuesCoalesced();
  else if (scenario !== "watch-live-immutable") drainWatchQueues(scenario === "watch-catch-up");
  assertWatchConvergence();
  postDeliveryRetainedMiB = await retainedFromBaseline();
  checksum = sum(watchers[0]!.value) + sum(tracker.value);
} else if (scenario !== "import") {
  ({ checksum, mutateMs, prepareMs, serializeMs, opBytes, operationCount, adoptMs } =
    runMutationScenario({ tracker, scenario, size, queueOperations, sample: samplePeak }));
}

const scenarioWorkMs =
  mutateMs + prepareMs + serializeMs + adoptMs + acquireMs + enqueueMs + deliveryMs;
samplePeak();
await Effect.runPromise(gc);
const retainedHeap = process.memoryUsage().heapUsed;
const retainedMiB = (retainedHeap - baselineHeap) / MiB;
const retainedOverReadyMiB = (retainedHeap - readyHeap) / MiB;
const watcherRoots = watchers.length;
const queuedBatchReferences = watchers.reduce((total, watcher) => total + watcher.queue.length, 0);
const listenerCount = borrowedListeners.length;
watchers.length = 0;
borrowedListeners.length = 0;
await Effect.runPromise(gc);
const releasedRetainedMiB = (process.memoryUsage().heapUsed - baselineHeap) / MiB;
await Effect.runPromise(
  Console.log(
    JSON.stringify({
      mode,
      scenario,
      size,
      trial,
      queueOperations,
      watchProfile: WATCH_SCENARIOS.has(scenario) ? "local-sparse-array-leaf" : null,
      watchCount: watcherRoots + listenerCount,
      watchUpdates: authoritySequence,
      queuedBatchReferences,
      importMs,
      mutateMs,
      prepareMs,
      serializeMs,
      adoptMs,
      acquireMs,
      enqueueMs,
      deliveryMs,
      scenarioWorkMs,
      opBytes,
      operationCount,
      checksum,
      readyMiB: (readyHeap - baselineHeap) / MiB,
      sampledAcquireMiB,
      sampledTransientMiB: (peakHeap - readyHeap) / MiB,
      retainedMiB,
      retainedOverReadyMiB,
      postAcquireRetainedMiB,
      postLagRetainedMiB,
      postDeliveryRetainedMiB,
      releasedRetainedMiB,
      maxRssMiB: process.resourceUsage().maxRSS / 1024,
    }),
  ),
);
