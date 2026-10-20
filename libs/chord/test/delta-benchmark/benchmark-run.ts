import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { Effect } from "effect";

import { applyImmutable } from "../../src/delta/index.ts";
import benchmark from "../fixtures/benchmark.ts";
import type benchmarkRunTypes from "./benchmark-run.types.ts";
import benchmarkWorkerModel from "./benchmark-worker-model.ts";
import type benchmarkWorkerModelTypes from "./benchmark-worker-model.types.ts";

const { collectGarbage } = benchmark;
const { MiB, applyFrame, assertDetached, cloneTrusted } = benchmarkWorkerModel;

const gc = collectGarbage(3);

const heapUsed = (): number => process.memoryUsage().heapUsed;

const samplePeak = (run: benchmarkRunTypes.Run): void => {
  run.metrics.peakHeap = Math.max(run.metrics.peakHeap, heapUsed());
};

const retainedFromBaseline = (run: benchmarkRunTypes.Run): Effect.Effect<number> =>
  Effect.map(gc, () => (heapUsed() - run.baselineHeap) / MiB);

const createWatch = (
  run: benchmarkRunTypes.Run,
  value: benchmarkRunTypes.Document,
): benchmarkWorkerModelTypes.WatchReplica => ({
  baseSequence: run.metrics.authoritySequence,
  queue: [],
  sequence: run.metrics.authoritySequence,
  value,
});

const timedAcquire = (run: benchmarkRunTypes.Run, acquire: () => void): void => {
  const beforeHeap = heapUsed();
  const start = performance.now();
  acquire();
  run.metrics.acquireMs += performance.now() - start;
  run.metrics.sampledAcquireMiB = Math.max(
    run.metrics.sampledAcquireMiB,
    (heapUsed() - beforeHeap) / MiB,
  );
};

const acquireSharedWatches = (run: benchmarkRunTypes.Run): void => {
  timedAcquire(run, () => {
    const base = run.tracker.value;
    run.watchers.push(...Array.from({ length: run.watchCount }, () => createWatch(run, base)));
  });
  for (const watcher of run.watchers) assert.equal(watcher.value, run.tracker.value);
  samplePeak(run);
};

const acquireDetachedWatches = (run: benchmarkRunTypes.Run): void => {
  timedAcquire(run, () => {
    run.watchers.push(
      ...Array.from({ length: run.watchCount }, () =>
        createWatch(run, cloneTrusted(run.tracker.value)),
      ),
    );
  });
  assertDetached(run.watchers, run.tracker.value);
  samplePeak(run);
};

const acquireOneWatch = (run: benchmarkRunTypes.Run): void => {
  timedAcquire(run, () => {
    run.watchers.push(createWatch(run, run.tracker.value));
  });
  samplePeak(run);
};

const timed = (run: benchmarkRunTypes.Run, work: () => void): number => {
  const start = performance.now();
  work();
  const elapsed = performance.now() - start;
  samplePeak(run);
  return elapsed;
};

const commitWatchUpdate = (
  run: benchmarkRunTypes.Run,
  update: number,
): benchmarkWorkerModelTypes.Frame => {
  const { metrics, tracker } = run;
  const change = tracker.beginChange();
  const row = ((update + 1) * 997) % run.size;
  metrics.mutateMs += timed(run, () => {
    change.state.rows[row]!.value = -update - 1;
  });
  let prepared: ReturnType<typeof change.prepare> | undefined;
  metrics.prepareMs += timed(run, () => {
    prepared = change.prepare();
  });
  const operations = prepared!.ops;
  metrics.operationCount += operations.length;
  metrics.adoptMs += timed(run, () => tracker.adopt(prepared!));
  metrics.authoritySequence += 1;
  return { ops: operations, sequence: metrics.authoritySequence };
};

const enqueueFrame = (run: benchmarkRunTypes.Run, frame: benchmarkWorkerModelTypes.Frame): void => {
  const start = performance.now();
  for (const watcher of run.watchers) {
    assert.equal(frame.sequence, watcher.sequence + watcher.queue.length + 1);
    watcher.queue.push(frame);
  }
  run.metrics.enqueueMs += performance.now() - start;
};

const drainWatchQueues = (run: benchmarkRunTypes.Run, measure: boolean): void => {
  const start = performance.now();
  for (const watcher of run.watchers) {
    for (const frame of watcher.queue) applyFrame(watcher, frame);
    watcher.queue.length = 0;
    samplePeak(run);
  }
  if (measure) run.metrics.deliveryMs += performance.now() - start;
};

const drainWatchQueuesCoalesced = (run: benchmarkRunTypes.Run): void => {
  const start = performance.now();
  for (const watcher of run.watchers) {
    const operations = watcher.queue.flatMap((frame) => frame.ops);
    watcher.value = applyImmutable(watcher.value, operations);
    watcher.sequence = watcher.queue.at(-1)?.sequence ?? watcher.sequence;
    watcher.queue.length = 0;
    samplePeak(run);
  }
  run.metrics.deliveryMs += performance.now() - start;
};

const assertWatchConvergence = (run: benchmarkRunTypes.Run): void => {
  for (const watcher of run.watchers) {
    assert.equal(watcher.sequence, run.metrics.authoritySequence);
    assert.deepEqual(watcher.value, run.tracker.value);
  }
};

const deliverToListeners = (run: benchmarkRunTypes.Run): void => {
  for (const listener of run.listeners)
    run.metrics.checksum += listener(run.tracker.value, run.metrics.authoritySequence);
};

const publishUpdates = (run: benchmarkRunTypes.Run): void => {
  for (let update = 0; update < run.watchUpdateTarget; update++) {
    const frame = commitWatchUpdate(run, update);
    if (run.scenario === "watch-live-immutable") {
      run.metrics.deliveryMs += timed(run, () => {
        for (const watcher of run.watchers) applyFrame(watcher, frame);
      });
    } else enqueueFrame(run, frame);
  }
};

const benchmarkRun = {
  acquireDetachedWatches,
  acquireOneWatch,
  acquireSharedWatches,
  assertWatchConvergence,
  commitWatchUpdate,
  createWatch,
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
  timedAcquire,
};

export default benchmarkRun;
