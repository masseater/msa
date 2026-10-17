import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { dual } from "effect/Function";

import type { Draft } from "../../src/delta/draft.ts";
import { applyImmutable, type Op, track } from "../../src/delta/index.ts";

export type Mode = "tracker";
export type Scenario =
  | "import"
  | "committed-read"
  | "draft-read"
  | "sparse"
  | "queue"
  | "sort"
  | "dense"
  | "unshift"
  | "watch-authority-control"
  | "watch-live-borrowed"
  | "watch-acquire-shared"
  | "watch-acquire-detached"
  | "watch-acquire-staggered"
  | "watch-lag"
  | "watch-catch-up"
  | "watch-catch-up-coalesced"
  | "watch-live-immutable";
export type Row = { id: number; value: number; payload: string };
export type Document = { rows: Row[] };
export type PreparedLike = { readonly value: Readonly<Document>; readonly ops: readonly Op[] };
export type ChangeLike = { readonly state: Draft<Document>; prepare(): PreparedLike };
export type TrackerLike = {
  readonly value: Document;
  beginChange(): ChangeLike;
  adopt(prepared: PreparedLike): void;
};
export type Frame = { readonly sequence: number; readonly ops: readonly Op[] };
export type WatchReplica = {
  value: Document;
  readonly baseSequence: number;
  sequence: number;
  readonly queue: Frame[];
};

export const MiB = 1024 * 1024;
export const MODES = new Set<Mode>(["tracker"]);
export const SCENARIOS = new Set<Scenario>([
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
export const WATCH_SCENARIOS = new Set<Scenario>([
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
export function fixture(count: number): Document {
  return {
    rows: Array.from({ length: count }, (_, id) => ({ id, value: id, payload: `row-${id}` })),
  };
}

export function cloneTrusted<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((child) => cloneTrusted(child)) as T;
  const result = Object.create(Object.getPrototypeOf(value)) as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    Object.defineProperty(result, key, {
      value: cloneTrusted((value as Record<string, unknown>)[key]),
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return result as T;
}

export function sum(document: Document | Draft<Document>): number {
  let checksum = 0;
  for (let index = 0; index < document.rows.length; index++)
    checksum += document.rows[index]!.value;
  return checksum;
}

export interface MutationMetrics {
  readonly checksum: number;
  readonly mutateMs: number;
  readonly prepareMs: number;
  readonly serializeMs: number;
  readonly opBytes: number;
  readonly operationCount: number;
  readonly adoptMs: number;
}

export interface MutationRun {
  readonly tracker: TrackerLike;
  readonly scenario: Scenario;
  readonly size: number;
  readonly queueOperations: number;
  readonly sample: () => void;
}

const mutateDraft = (state: Draft<Document>, run: MutationRun): number => {
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
        state.rows.push({ id: size + index, value: index, payload: "queue" });
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
        value: id,
        payload: "inserted",
      }));
      Reflect.apply(state.rows.unshift, state.rows, inserted);
      return state.rows.length;
    }
    default:
      throw new Error(`Unhandled benchmark scenario ${scenario}`);
  }
};

export const runMutationScenario = (run: MutationRun): MutationMetrics => {
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
  return { checksum, mutateMs, prepareMs, serializeMs, opBytes, operationCount, adoptMs };
};

export interface WorkerArguments {
  readonly mode: Mode;
  readonly scenario: Scenario;
  readonly size: number;
  readonly trial: number;
  readonly requestedWatchCount: number;
  readonly requestedWatchUpdates: number;
}

export const parseArguments = (argv: readonly string[]): WorkerArguments => {
  const mode = argv[2] as Mode;
  const scenario = argv[3] as Scenario;
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
  return { mode, scenario, size, trial, requestedWatchCount, requestedWatchUpdates };
};

const assertDetachedImpl = (watchers: readonly WatchReplica[], value: Document): void => {
  for (let left = 0; left < watchers.length; left++) {
    assert.notEqual(watchers[left]!.value, value);
    for (let right = left + 1; right < watchers.length; right++) {
      assert.notEqual(watchers[left]!.value, watchers[right]!.value);
    }
  }
};

export const assertDetached: {
  (value: Document): (watchers: readonly WatchReplica[]) => void;
  (watchers: readonly WatchReplica[], value: Document): void;
} = dual(2, assertDetachedImpl);

const applyFrameImpl = (watcher: WatchReplica, frame: Frame): void => {
  assert.equal(frame.sequence, watcher.sequence + 1);
  watcher.value = applyImmutable(watcher.value, frame.ops);
  watcher.sequence = frame.sequence;
};

export const applyFrame: {
  (frame: Frame): (watcher: WatchReplica) => void;
  (watcher: WatchReplica, frame: Frame): void;
} = dual(2, applyFrameImpl);

const importFixtureImpl = (
  size: number,
  scenario: Scenario,
): { readonly tracker: TrackerLike; readonly importMs: number } => {
  const input = fixture(size);
  if (scenario === "sort") input.rows.reverse();
  const importStart = performance.now();
  const imported = track(input) as TrackerLike;
  return { tracker: imported, importMs: performance.now() - importStart };
};

export const importFixture: {
  (scenario: Scenario): (size: number) => ReturnType<typeof importFixtureImpl>;
  (size: number, scenario: Scenario): ReturnType<typeof importFixtureImpl>;
} = dual(2, importFixtureImpl);
