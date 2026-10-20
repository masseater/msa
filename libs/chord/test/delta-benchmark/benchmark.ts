import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { Console, Effect, Exit } from "effect";

import benchmarkModule from "../fixtures/benchmark.ts";
import platform from "../fixtures/platform.ts";

const { decodeJson, encodeJson, encodePrettyJson } = benchmarkModule;
const { runNode, writeText } = platform;

type Mode = "tracker";
type Scenario =
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
type Result = {
  mode: Mode;
  scenario: Scenario;
  size: number;
  trial: number;
  queueOperations: number;
  watchProfile: string | null;
  watchCount: number;
  watchUpdates: number;
  queuedBatchReferences: number;
  importMs: number;
  mutateMs: number;
  prepareMs: number;
  serializeMs: number;
  adoptMs: number;
  acquireMs: number;
  enqueueMs: number;
  deliveryMs: number;
  scenarioWorkMs: number;
  opBytes: number;
  operationCount: number;
  checksum: number;
  readyMiB: number;
  sampledAcquireMiB: number;
  sampledTransientMiB: number;
  retainedMiB: number;
  retainedOverReadyMiB: number;
  postAcquireRetainedMiB: number;
  postLagRetainedMiB: number;
  postDeliveryRetainedMiB: number;
  releasedRetainedMiB: number;
  maxRssMiB: number;
};

type Failure = { mode: Mode; scenario: Scenario; trial: number; stderr: string };

const ordinaryScenarios: readonly Scenario[] = [
  "import",
  "committed-read",
  "draft-read",
  "sparse",
  "queue",
  "sort",
  "dense",
  "unshift",
];
const watchScenarios: readonly Scenario[] = [
  "watch-authority-control",
  "watch-live-borrowed",
  "watch-acquire-shared",
  "watch-acquire-detached",
  "watch-acquire-staggered",
  "watch-lag",
  "watch-catch-up",
  "watch-catch-up-coalesced",
  "watch-live-immutable",
];
const modes: readonly Mode[] = ["tracker"];
const quick = process.argv.includes("--quick");
const watchOnly = process.argv.includes("--watch-only");
const ordinaryOnly = process.argv.includes("--ordinary-only");
if (watchOnly && ordinaryOnly) throw new Error("Choose at most one scenario filter");
const scenarios = watchOnly
  ? watchScenarios
  : ordinaryOnly
    ? ordinaryScenarios
    : [...ordinaryScenarios, ...watchScenarios];
const size = quick ? 10_000 : 100_000;
const trials = quick ? 1 : 3;
const watchCount = quick ? 4 : 8;
const watchUpdates = quick ? 20 : 100;
const root = fileURLToPath(new URL("../../../..", import.meta.url));
const worker = fileURLToPath(new URL("./benchmark.worker.ts", import.meta.url));
const results: Result[] = [];
const failures: Failure[] = [];

const runScenario = (mode: Mode, scenario: Scenario, trial: number) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(
      runNode(
        [
          "--expose-gc",
          "--max-old-space-size=4096",
          worker,
          mode,
          scenario,
          String(size),
          String(trial),
          String(watchCount),
          String(watchUpdates),
        ],
        { cwd: root, timeout: 300_000 },
      ),
    );
    if (Exit.isSuccess(exit) && exit.value.status === 0) {
      const result = (yield* decodeJson(exit.value.stdout)) as Result;
      results.push(result);
      yield* Console.log(yield* encodeJson(result));
    } else {
      const stderr = Exit.isSuccess(exit) ? exit.value.stderr : String(exit.cause);
      const failure = { mode, scenario, stderr, trial } satisfies Failure;
      failures.push(failure);
      yield* Console.log(yield* encodeJson(failure));
    }
  });

const runScenarios = Effect.gen(function* () {
  for (let trial = 0; trial < trials; trial++) {
    for (const scenario of scenarios) {
      for (const mode of modes) yield* runScenario(mode, scenario, trial);
    }
  }
});

const average = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;
const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)]!;
};
const range = (values: readonly number[]): readonly [number, number] | null =>
  values.length === 0 ? null : [Math.min(...values), Math.max(...values)];
const metricNames = [
  "importMs",
  "mutateMs",
  "prepareMs",
  "serializeMs",
  "adoptMs",
  "acquireMs",
  "enqueueMs",
  "deliveryMs",
  "scenarioWorkMs",
  "opBytes",
  "operationCount",
  "readyMiB",
  "sampledAcquireMiB",
  "sampledTransientMiB",
  "retainedMiB",
  "retainedOverReadyMiB",
  "postAcquireRetainedMiB",
  "postLagRetainedMiB",
  "postDeliveryRetainedMiB",
  "releasedRetainedMiB",
  "maxRssMiB",
] as const satisfies readonly (keyof Result)[];

const summarize = () =>
  scenarios.flatMap((scenario) =>
    modes.map((mode) => {
      const selected = results.filter(
        (result) => result.mode === mode && result.scenario === scenario,
      );
      const averages: Record<string, number | null> = {};
      const medians: Record<string, number | null> = {};
      const ranges: Record<string, readonly [number, number] | null> = {};
      for (const metric of metricNames) {
        const values = selected.map((result) => result[metric]);
        averages[metric] = average(values);
        medians[metric] = median(values);
        ranges[metric] = range(values);
      }
      return {
        averages,
        medians,
        mode,
        ranges,
        scenario,
        watchCount: selected[0]?.watchCount ?? 0,
        watchProfile: selected[0]?.watchProfile ?? null,
        watchUpdates: selected[0]?.watchUpdates ?? 0,
      };
    }),
  );
const output = `${tmpdir()}/chord-delta-benchmark.json`;
void Effect.runPromise(
  Effect.gen(function* () {
    yield* runScenarios;
    const summary = summarize();
    const report = {
      failures,
      node: process.version,
      results,
      size,
      summary,
      trials,
      watchCount,
      watchUpdates,
    };
    yield* writeText(output, yield* encodePrettyJson(report));
    yield* Console.log(
      yield* encodeJson({
        failures: failures.length,
        node: process.version,
        output,
        size,
        summary,
        trials,
        watchCount,
        watchUpdates,
      }),
    );
  }),
);
