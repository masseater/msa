import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { Console, Effect, Schema } from "effect";

import benchmarkRun from "./benchmark-run.ts";
import type benchmarkRunTypes from "./benchmark-run.types.ts";
import benchmarkWorkerModel from "./benchmark-worker-model.ts";
const {
  acquireDetachedWatches,
  acquireOneWatch,
  acquireSharedWatches,
  assertWatchConvergence,
  commitWatchUpdate,
  deliverToListeners,
  drainWatchQueues,
  drainWatchQueuesCoalesced,
  enqueueFrame,
  gc,
  heapUsed,
  publishUpdates,
  retainedFromBaseline,
  samplePeak,
  timed,
} = benchmarkRun;

const { MiB, WATCH_SCENARIOS, importFixture, parseArguments, runMutationScenario, sum } =
  benchmarkWorkerModel;

const { mode, scenario, size, trial, requestedWatchCount, requestedWatchUpdates } = parseArguments(
  process.argv,
);

const committedRead = (run: benchmarkRunTypes.Run): Effect.Effect<void> =>
  Effect.sync(() => {
    run.metrics.mutateMs = timed(run, () => {
      run.metrics.checksum = sum(run.tracker.value);
    });
  });

const watchAuthorityControl = (run: benchmarkRunTypes.Run): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let update = 0; update < run.watchUpdateTarget; update++) commitWatchUpdate(run, update);
    run.metrics.postDeliveryRetainedMiB = yield* retainedFromBaseline(run);
    run.metrics.checksum = sum(run.tracker.value);
  });

const watchLiveBorrowed = (run: benchmarkRunTypes.Run): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { metrics } = run;
    const start = performance.now();
    run.listeners.push(
      ...Array.from(
        { length: run.watchCount },
        (): benchmarkRunTypes.Listener => (value, sequence) => value.rows[0]!.value + sequence,
      ),
    );
    deliverToListeners(run);
    metrics.acquireMs = performance.now() - start;
    metrics.postAcquireRetainedMiB = yield* retainedFromBaseline(run);
    for (let update = 0; update < run.watchUpdateTarget; update++) {
      commitWatchUpdate(run, update);
      metrics.deliveryMs += timed(run, () => deliverToListeners(run));
    }
    metrics.postDeliveryRetainedMiB = yield* retainedFromBaseline(run);
  });

const watchAcquire = (run: benchmarkRunTypes.Run): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (scenario === "watch-acquire-shared") acquireSharedWatches(run);
    else acquireDetachedWatches(run);
    run.metrics.postAcquireRetainedMiB = yield* retainedFromBaseline(run);
    run.metrics.checksum = sum(run.watchers[0]!.value) + run.watchers.length;
  });

const watchAcquireStaggered = (run: benchmarkRunTypes.Run): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let watcher = 0; watcher < run.watchCount; watcher++) {
      acquireOneWatch(run);
      if (watcher + 1 === run.watchCount) break;
      enqueueFrame(run, commitWatchUpdate(run, watcher));
    }
    for (const [index, watcher] of run.watchers.entries()) {
      assert.equal(watcher.baseSequence, index);
      assert.equal(watcher.queue.length, run.watchCount - index - 1);
    }
    run.metrics.postAcquireRetainedMiB = yield* retainedFromBaseline(run);
    drainWatchQueues(run, false);
    assertWatchConvergence(run);
    run.metrics.postDeliveryRetainedMiB = yield* retainedFromBaseline(run);
    run.metrics.checksum = sum(run.watchers[0]!.value) + sum(run.watchers.at(-1)!.value);
  });

const watchLag = (run: benchmarkRunTypes.Run): Effect.Effect<void> =>
  Effect.gen(function* () {
    acquireSharedWatches(run);
    run.metrics.postAcquireRetainedMiB = yield* retainedFromBaseline(run);
    publishUpdates(run);
    run.metrics.postLagRetainedMiB = yield* retainedFromBaseline(run);
    if (scenario === "watch-catch-up-coalesced") drainWatchQueuesCoalesced(run);
    else if (scenario !== "watch-live-immutable")
      drainWatchQueues(run, scenario === "watch-catch-up");
    assertWatchConvergence(run);
    run.metrics.postDeliveryRetainedMiB = yield* retainedFromBaseline(run);
    run.metrics.checksum = sum(run.watchers[0]!.value) + sum(run.tracker.value);
  });

const LAG_SCENARIOS = new Set([
  "watch-catch-up",
  "watch-catch-up-coalesced",
  "watch-lag",
  "watch-live-immutable",
]);

const mutate = (run: benchmarkRunTypes.Run): Effect.Effect<void> =>
  Effect.sync(() => {
    Object.assign(
      run.metrics,
      runMutationScenario({
        queueOperations: Math.min(size, 1_000),
        sample: () => samplePeak(run),
        scenario,
        size,
        tracker: run.tracker,
      }),
    );
  });

const runScenario = (run: benchmarkRunTypes.Run): Effect.Effect<void> => {
  if (scenario === "committed-read") return committedRead(run);
  if (scenario === "watch-authority-control") return watchAuthorityControl(run);
  if (scenario === "watch-live-borrowed") return watchLiveBorrowed(run);
  if (scenario === "watch-acquire-shared" || scenario === "watch-acquire-detached")
    return watchAcquire(run);
  if (scenario === "watch-acquire-staggered") return watchAcquireStaggered(run);
  if (LAG_SCENARIOS.has(scenario)) return watchLag(run);
  return scenario === "import" ? Effect.void : mutate(run);
};

const encodeLine = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const report = (run: benchmarkRunTypes.Run, importMs: number): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { metrics } = run;
    const scenarioWorkMs =
      metrics.mutateMs +
      metrics.prepareMs +
      metrics.serializeMs +
      metrics.adoptMs +
      metrics.acquireMs +
      metrics.enqueueMs +
      metrics.deliveryMs;
    samplePeak(run);
    yield* gc;
    const retainedHeap = heapUsed();
    const watchCount = run.watchers.length + run.listeners.length;
    const queuedBatchReferences = run.watchers.reduce((total, w) => total + w.queue.length, 0);
    run.watchers.length = 0;
    run.listeners.length = 0;
    yield* gc;
    const { authoritySequence, peakHeap, ...measured } = metrics;
    const line = yield* Effect.orDie(
      encodeLine({
        ...measured,
        importMs,
        maxRssMiB: process.resourceUsage().maxRSS / 1024,
        mode,
        queueOperations: Math.min(size, 1_000),
        queuedBatchReferences,
        readyMiB: (run.readyHeap - run.baselineHeap) / MiB,
        releasedRetainedMiB: (heapUsed() - run.baselineHeap) / MiB,
        retainedMiB: (retainedHeap - run.baselineHeap) / MiB,
        retainedOverReadyMiB: (retainedHeap - run.readyHeap) / MiB,
        sampledTransientMiB: (peakHeap - run.readyHeap) / MiB,
        scenario,
        scenarioWorkMs,
        size,
        trial,
        watchCount,
        watchProfile: WATCH_SCENARIOS.has(scenario) ? "local-sparse-array-leaf" : null,
        watchUpdates: authoritySequence,
      }),
    );
    yield* Console.log(line);
  });

const createMetrics = (readyHeap: number): benchmarkRunTypes.Metrics => ({
  acquireMs: 0,
  adoptMs: 0,
  authoritySequence: 0,
  checksum: 0,
  deliveryMs: 0,
  enqueueMs: 0,
  mutateMs: 0,
  opBytes: 0,
  operationCount: 0,
  peakHeap: readyHeap,
  postAcquireRetainedMiB: 0,
  postDeliveryRetainedMiB: 0,
  postLagRetainedMiB: 0,
  prepareMs: 0,
  sampledAcquireMiB: 0,
  serializeMs: 0,
});

const main = Effect.gen(function* () {
  yield* gc;
  const baselineHeap = heapUsed();
  const { tracker, importMs } = importFixture(size, scenario);
  yield* gc;
  const readyHeap = heapUsed();
  const watching = WATCH_SCENARIOS.has(scenario);
  const run: benchmarkRunTypes.Run = {
    baselineHeap,
    listeners: [],
    metrics: createMetrics(readyHeap),
    readyHeap,
    scenario,
    size,
    tracker,
    watchCount: watching ? requestedWatchCount : 0,
    watchUpdateTarget: watching ? requestedWatchUpdates : 0,
    watchers: [],
  };
  yield* runScenario(run);
  yield* report(run, importMs);
});

void Effect.runPromise(main);
