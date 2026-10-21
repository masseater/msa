import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { dual } from "effect/Function";

import type draftTypes from "../../src/delta/draft.ts";
import delta from "../../src/delta/index.ts";
import type benchmarkWorkerModelTypes from "./benchmark-worker-model.types.ts";

const { applyImmutable, track } = delta;

const MiB = 1024 * 1024;
const MODES = new Set<benchmarkWorkerModelTypes.Mode>(["tracker"]);
const SCENARIOS = new Set<benchmarkWorkerModelTypes.Scenario>([
  "import",
  "committed-read",
  "draft-read",
  "sparse",
  "queue",
  "sort",
  "dense",
  "unshift",
  "watch-authority-control",
  "watch-live-borrowed",
  "watch-acquire-shared",
  "watch-acquire-detached",
  "watch-acquire-staggered",
  "watch-lag",
  "watch-catch-up",
  "watch-catch-up-coalesced",
  "watch-live-immutable",
]);
const WATCH_SCENARIOS = new Set<benchmarkWorkerModelTypes.Scenario>([
  "watch-authority-control",
  "watch-live-borrowed",
  "watch-acquire-shared",
  "watch-acquire-detached",
  "watch-acquire-staggered",
  "watch-lag",
  "watch-catch-up",
  "watch-catch-up-coalesced",
  "watch-live-immutable",
]);
function fixture(count: number): benchmarkWorkerModelTypes.Document {
  return {
    rows: Array.from({ length: count }, (_, id) => ({ id, payload: `row-${id}`, value: id })),
  };
}

function cloneTrusted<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((child) => cloneTrusted(child)) as T;
  const result = Object.create(Object.getPrototypeOf(value)) as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: cloneTrusted((value as Record<string, unknown>)[key]),
      writable: true,
    });
  }
  return result as T;
}

function sum(
  document:
    | benchmarkWorkerModelTypes.Document
    | draftTypes.Draft<benchmarkWorkerModelTypes.Document>,
): number {
  let checksum = 0;
  for (let index = 0; index < document.rows.length; index++)
    checksum += document.rows[index]!.value;
  return checksum;
}

const mutateDraft = (
  state: draftTypes.Draft<benchmarkWorkerModelTypes.Document>,
  run: benchmarkWorkerModelTypes.MutationRun,
): number => {
  const { scenario, size, queueOperations } = run;
  switch (scenario) {
    case "draft-read":
      return sum(state);
    case "sparse":
      for (let index = 0; index < size; index += 1_000) state.rows[index]!.value = -index;
      return state.rows.at(-1)!.value;
    case "queue":
      for (let index = 0; index < queueOperations; index++) {
        state.rows.shift();
        state.rows.push({ id: size + index, payload: "queue", value: index });
      }
      return state.rows.length;
    case "sort":
      state.rows.sort((left, right) => left.id - right.id);
      return state.rows[0]!.id;
    case "dense":
      for (let index = 0; index < size; index++) state.rows[index]!.value = -index;
      return state.rows.at(-1)!.value;
    case "unshift": {
      const inserted = Array.from({ length: 100_000 }, (_, id) => ({
        id: -id,
        payload: "inserted",
        value: id,
      }));
      Reflect.apply(state.rows.unshift, state.rows, inserted);
      return state.rows.length;
    }
    default:
      throw new Error(`Unhandled benchmark scenario ${scenario}`);
  }
};

const runMutationScenario = (
  run: benchmarkWorkerModelTypes.MutationRun,
): benchmarkWorkerModelTypes.MutationMetrics => {
  const { tracker, sample } = run;
  const change = tracker.beginChange();
  const start = performance.now();
  const checksum = mutateDraft(change.state, run);
  const mutateMs = performance.now() - start;
  sample();
  const prepareStart = performance.now();
  const prepared = change.prepare();
  const prepareMs = performance.now() - prepareStart;
  sample();
  const serializeStart = performance.now();
  const serialized = JSON.stringify(prepared.ops);
  const serializeMs = performance.now() - serializeStart;
  const opBytes = Buffer.byteLength(serialized);
  const operationCount = prepared.ops.length;
  sample();
  const adoptStart = performance.now();
  tracker.adopt(prepared);
  const adoptMs = performance.now() - adoptStart;
  return { adoptMs, checksum, mutateMs, opBytes, operationCount, prepareMs, serializeMs };
};

const parseArguments = (argv: readonly string[]): benchmarkWorkerModelTypes.WorkerArguments => {
  const mode = argv[2] as benchmarkWorkerModelTypes.Mode;
  const scenario = argv[3] as benchmarkWorkerModelTypes.Scenario;
  if (!MODES.has(mode)) throw new Error(`Unknown benchmark mode ${mode}`);
  if (!SCENARIOS.has(scenario)) throw new Error(`Unknown benchmark scenario ${scenario}`);
  const requestedWatchCount = Number(argv[6] ?? 8);
  const requestedWatchUpdates = Number(argv[7] ?? 100);
  if (!Number.isSafeInteger(requestedWatchCount) || requestedWatchCount < 1)
    throw new RangeError("Invalid watch count");
  if (!Number.isSafeInteger(requestedWatchUpdates) || requestedWatchUpdates < 0)
    throw new RangeError("Invalid watch update count");
  const size = Number(argv[4] ?? 100_000);
  const trial = Number(argv[5] ?? 0);
  return { mode, requestedWatchCount, requestedWatchUpdates, scenario, size, trial };
};

const assertDetachedImpl = (
  watchers: readonly benchmarkWorkerModelTypes.WatchReplica[],
  value: benchmarkWorkerModelTypes.Document,
): void => {
  for (let left = 0; left < watchers.length; left++) {
    assert.notEqual(watchers[left]!.value, value);
    for (let right = left + 1; right < watchers.length; right++) {
      assert.notEqual(watchers[left]!.value, watchers[right]!.value);
    }
  }
};

const assertDetached: {
  (
    value: benchmarkWorkerModelTypes.Document,
  ): (watchers: readonly benchmarkWorkerModelTypes.WatchReplica[]) => void;
  (
    watchers: readonly benchmarkWorkerModelTypes.WatchReplica[],
    value: benchmarkWorkerModelTypes.Document,
  ): void;
} = dual(2, assertDetachedImpl);

const applyFrameImpl = (
  watcher: benchmarkWorkerModelTypes.WatchReplica,
  frame: benchmarkWorkerModelTypes.Frame,
): void => {
  assert.equal(frame.sequence, watcher.sequence + 1);
  watcher.value = applyImmutable(watcher.value, frame.ops);
  watcher.sequence = frame.sequence;
};

const applyFrame: {
  (
    frame: benchmarkWorkerModelTypes.Frame,
  ): (watcher: benchmarkWorkerModelTypes.WatchReplica) => void;
  (watcher: benchmarkWorkerModelTypes.WatchReplica, frame: benchmarkWorkerModelTypes.Frame): void;
} = dual(2, applyFrameImpl);

const importFixtureImpl = (
  size: number,
  scenario: benchmarkWorkerModelTypes.Scenario,
): { readonly tracker: benchmarkWorkerModelTypes.TrackerLike; readonly importMs: number } => {
  const input = fixture(size);
  if (scenario === "sort") input.rows.reverse();
  const importStart = performance.now();
  const imported = track(input) as benchmarkWorkerModelTypes.TrackerLike;
  return { importMs: performance.now() - importStart, tracker: imported };
};

const importFixture: {
  (
    scenario: benchmarkWorkerModelTypes.Scenario,
  ): (size: number) => ReturnType<typeof importFixtureImpl>;
  (
    size: number,
    scenario: benchmarkWorkerModelTypes.Scenario,
  ): ReturnType<typeof importFixtureImpl>;
} = dual(2, importFixtureImpl);

const benchmarkWorkerModel = {
  MODES,
  MiB,
  SCENARIOS,
  WATCH_SCENARIOS,
  applyFrame,
  assertDetached,
  cloneTrusted,
  fixture,
  importFixture,
  parseArguments,
  runMutationScenario,
  sum,
};

export default benchmarkWorkerModel;
