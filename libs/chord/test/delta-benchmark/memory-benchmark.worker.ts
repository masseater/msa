import { PerformanceObserver, performance } from "node:perf_hooks";

import { Console, Effect, Schema } from "effect";

import type { Draft } from "../../src/delta/draft.ts";
import { type Op, track } from "../../src/delta/index.ts";
import benchmark from "../fixtures/benchmark.ts";
import timing from "../fixtures/timing.ts";

const { collectGarbage } = benchmark;
const { ticks } = timing;

const MiB = 1024 * 1024;

type Mode = "tracker";
type Scenario = "idle-control" | "sparse-burst" | "staggered-revisions" | "lagging-watches";
type Row = { id: number; value: number; payload: string };
type Document = { rows: Row[] };
type PreparedLike = { readonly value: Document; readonly ops: readonly Op[] };
type ChangeLike = { readonly state: Draft<Document>; prepare(): PreparedLike };
type TrackerLike = {
  readonly value: Document;
  beginChange(): ChangeLike;
  adopt(prepared: PreparedLike): void;
};

const MODES = new Set<Mode>(["tracker"]);
const SCENARIOS = new Set<Scenario>([
  "idle-control",
  "sparse-burst",
  "staggered-revisions",
  "lagging-watches",
]);
const mode = process.argv[2] as Mode;
const scenario = process.argv[3] as Scenario;
const size = Number(process.argv[4] ?? 100_000);
const updates = Number(process.argv[5] ?? 100);
const watchCount = Number(process.argv[6] ?? 8);
const trial = Number(process.argv[7] ?? 0);
if (!MODES.has(mode)) throw new Error(`Unknown mode ${mode}`);
if (!SCENARIOS.has(scenario)) throw new Error(`Unknown scenario ${scenario}`);
if (!Number.isSafeInteger(size) || size < 1) throw new RangeError("Invalid size");
if (!Number.isSafeInteger(updates) || updates < 1) throw new RangeError("Invalid update count");
if (!Number.isSafeInteger(watchCount) || watchCount < 1)
  throw new RangeError("Invalid watch count");

function fixture(count: number): Document {
  return {
    rows: Array.from({ length: count }, (_, id) => ({ id, payload: `row-${id}`, value: id })),
  };
}

const collect = collectGarbage(3);

function createTracker(value: Document): TrackerLike {
  return track(value) as TrackerLike;
}

function commitUpdate(tracker: TrackerLike, update: number): void {
  const change = tracker.beginChange();
  const row = ((update + 1) * 997) % size;
  change.state.rows[row]!.value = -update - 1;
  const prepared = change.prepare();
  tracker.adopt(prepared);
}

function acquireSnapshot(tracker: TrackerLike): Document {
  return tracker.value;
}

const warmUp = (): void => {
  const warmup = createTracker(fixture(16));
  const warmupChange = warmup.beginChange();
  warmupChange.state.rows[0]!.value = -1;
  const warmupPrepared = warmupChange.prepare();
  warmup.adopt(warmupPrepared);
};

interface Measure {
  acquisitionMs: number;
  gcCount: number;
  gcMs: number;
  peakHeap: number;
  peakRss: number;
  snapshots: Document[];
}

interface Samples {
  readonly afterSnapshotRelease: NodeJS.MemoryUsage;
  readonly checksum: number;
  readonly processBaseline: NodeJS.MemoryUsage;
  readonly ready: NodeJS.MemoryUsage;
  readonly released: NodeJS.MemoryUsage;
  readonly retained: NodeJS.MemoryUsage;
  readonly workMs: number;
}

const samplePeak = (measure: Measure): void => {
  const memory = process.memoryUsage();
  measure.peakHeap = Math.max(measure.peakHeap, memory.heapUsed);
  measure.peakRss = Math.max(measure.peakRss, memory.rss);
};

const acquire = (measure: Measure, tracker: TrackerLike): void => {
  const start = performance.now();
  measure.snapshots.push(acquireSnapshot(tracker));
  measure.acquisitionMs += performance.now() - start;
  samplePeak(measure);
};

const observeGc = (measure: Measure): PerformanceObserver => {
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      measure.gcCount += 1;
      measure.gcMs += entry.duration;
    }
  });
  observer.observe({ entryTypes: ["gc"] });
  return observer;
};

const updateEach = (measure: Measure, tracker: TrackerLike): void => {
  for (let update = 0; update < updates; update++) {
    commitUpdate(tracker, update);
    samplePeak(measure);
  }
};

const runWork = (measure: Measure, tracker: TrackerLike): number => {
  const workStart = performance.now();
  if (scenario === "idle-control") {
    for (let update = 0; update < updates; update++) samplePeak(measure);
  } else if (scenario === "sparse-burst") {
    updateEach(measure, tracker);
  } else if (scenario === "staggered-revisions") {
    for (let watcher = 0; watcher < watchCount; watcher++) {
      acquire(measure, tracker);
      if (watcher + 1 < watchCount) commitUpdate(tracker, watcher);
      samplePeak(measure);
    }
  } else {
    for (let watcher = 0; watcher < watchCount; watcher++) acquire(measure, tracker);
    updateEach(measure, tracker);
  }
  return performance.now() - workStart;
};

const encodeLine = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const overMiB = (after: number, before: number): number => (after - before) / MiB;

const report = (measure: Measure, samples: Samples): Effect.Effect<void> => {
  const { afterSnapshotRelease, processBaseline, ready, released, retained } = samples;
  const staggered = scenario === "staggered-revisions";
  return Effect.flatMap(
    Effect.orDie(
      encodeLine({
        acquisitionMs: measure.acquisitionMs,
        afterSnapshotReleaseOverProcessBaselineHeapMiB: overMiB(
          afterSnapshotRelease.heapUsed,
          processBaseline.heapUsed,
        ),
        afterSnapshotReleaseOverReadyHeapMiB: overMiB(
          afterSnapshotRelease.heapUsed,
          ready.heapUsed,
        ),
        checksum: samples.checksum,
        gcCount: measure.gcCount,
        gcMs: measure.gcMs,
        maxRssMiB: process.resourceUsage().maxRSS / 1024,
        mode,
        peakOverProcessBaselineHeapMiB: overMiB(measure.peakHeap, processBaseline.heapUsed),
        peakOverReadyHeapMiB: overMiB(measure.peakHeap, ready.heapUsed),
        peakOverReadyRssMiB: overMiB(measure.peakRss, ready.rss),
        readyHeapMiB: overMiB(ready.heapUsed, processBaseline.heapUsed),
        readyRssMiB: overMiB(ready.rss, processBaseline.rss),
        releasedOverProcessBaselineHeapMiB: overMiB(released.heapUsed, processBaseline.heapUsed),
        releasedOverProcessBaselineRssMiB: overMiB(released.rss, processBaseline.rss),
        retainedOverProcessBaselineHeapMiB: overMiB(retained.heapUsed, processBaseline.heapUsed),
        retainedOverReadyHeapMiB: overMiB(retained.heapUsed, ready.heapUsed),
        retainedOverReadyRssMiB: overMiB(retained.rss, ready.rss),
        scenario,
        size,
        snapshotRetainedHeapMiB: overMiB(retained.heapUsed, afterSnapshotRelease.heapUsed),
        trial,
        updates: staggered ? watchCount - 1 : scenario === "idle-control" ? 0 : updates,
        watchCount: staggered || scenario === "lagging-watches" ? watchCount : 0,
        workMs: samples.workMs,
      }),
    ),
    (line) => Console.log(line),
  );
};

const main = Effect.gen(function* () {
  warmUp();
  yield* collect;
  const processBaseline = process.memoryUsage();
  const held: { tracker: TrackerLike | undefined } = { tracker: createTracker(fixture(size)) };
  yield* collect;
  const ready = process.memoryUsage();
  const measure: Measure = {
    acquisitionMs: 0,
    gcCount: 0,
    gcMs: 0,
    peakHeap: ready.heapUsed,
    peakRss: ready.rss,
    snapshots: [],
  };
  const observer = observeGc(measure);
  const workMs = runWork(measure, held.tracker!);
  yield* ticks(3);
  observer.disconnect();
  samplePeak(measure);
  yield* collect;
  const retained = process.memoryUsage();
  const checksum =
    held.tracker!.value.rows[0]!.value +
    held.tracker!.value.rows.at(-1)!.value +
    measure.snapshots.length;
  measure.snapshots = [];
  yield* collect;
  const afterSnapshotRelease = process.memoryUsage();
  held.tracker = undefined;
  yield* collect;
  const released = process.memoryUsage();
  yield* report(measure, {
    afterSnapshotRelease,
    checksum,
    processBaseline,
    ready,
    released,
    retained,
    workMs,
  });
});

void Effect.runPromise(main);
