import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { Console, Effect, Exit } from "effect";

import { decodeJson, encodeJson, encodePrettyJson } from "../fixtures/benchmark.ts";
import { runNode, writeText } from "../fixtures/platform.ts";

type Mode = "tracker";
type Scenario = "idle-control" | "sparse-burst" | "staggered-revisions" | "lagging-watches";
type Result = {
  mode: Mode;
  scenario: Scenario;
  trial: number;
  size: number;
  updates: number;
  watchCount: number;
  workMs: number;
  acquisitionMs: number;
  gcCount: number;
  gcMs: number;
  readyHeapMiB: number;
  readyRssMiB: number;
  peakOverReadyHeapMiB: number;
  peakOverProcessBaselineHeapMiB: number;
  peakOverReadyRssMiB: number;
  retainedOverReadyHeapMiB: number;
  retainedOverProcessBaselineHeapMiB: number;
  retainedOverReadyRssMiB: number;
  snapshotRetainedHeapMiB: number;
  afterSnapshotReleaseOverReadyHeapMiB: number;
  afterSnapshotReleaseOverProcessBaselineHeapMiB: number;
  releasedOverProcessBaselineHeapMiB: number;
  releasedOverProcessBaselineRssMiB: number;
  maxRssMiB: number;
  checksum: number;
};
type Failure = { mode: Mode; scenario: Scenario; trial: number; stderr: string };

const modes: readonly Mode[] = ["tracker"];
const scenarios: readonly Scenario[] = [
  "idle-control",
  "sparse-burst",
  "staggered-revisions",
  "lagging-watches",
];
const metrics = [
  "workMs",
  "acquisitionMs",
  "gcCount",
  "gcMs",
  "readyHeapMiB",
  "readyRssMiB",
  "peakOverReadyHeapMiB",
  "peakOverProcessBaselineHeapMiB",
  "peakOverReadyRssMiB",
  "retainedOverReadyHeapMiB",
  "retainedOverProcessBaselineHeapMiB",
  "retainedOverReadyRssMiB",
  "snapshotRetainedHeapMiB",
  "afterSnapshotReleaseOverReadyHeapMiB",
  "afterSnapshotReleaseOverProcessBaselineHeapMiB",
  "releasedOverProcessBaselineHeapMiB",
  "releasedOverProcessBaselineRssMiB",
  "maxRssMiB",
] as const satisfies readonly (keyof Result)[];

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)]!;
}

function range(values: readonly number[]): readonly [number, number] | null {
  return values.length === 0 ? null : [Math.min(...values), Math.max(...values)];
}

const quick = process.argv.includes("--quick");
const size = quick ? 10_000 : 100_000;
const updates = quick ? 20 : 100;
const watchCount = quick ? 4 : 8;
const trials = quick ? 1 : 3;
const root = fileURLToPath(new URL("../../../..", import.meta.url));
const worker = fileURLToPath(new URL("./memory-benchmark.worker.ts", import.meta.url));
const results: Result[] = [];
const failures: Failure[] = [];

const runScenario = (mode: Mode, scenario: Scenario, trial: number) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(
      runNode(
        [
          "--expose-gc",
          "--no-flush-bytecode",
          "--max-old-space-size=4096",
          worker,
          mode,
          scenario,
          String(size),
          String(updates),
          String(watchCount),
          String(trial),
        ],
        { cwd: root, timeout: 300_000 },
      ),
    );
    if (Exit.isSuccess(exit) && exit.value.status === 0) {
      const result = (yield* decodeJson(exit.value.stdout)) as Result;
      results.push(result);
      yield* Console.log(yield* encodeJson(result));
      return;
    }
    const stderr = Exit.isSuccess(exit) ? exit.value.stderr : String(exit.cause);
    const failure = { mode, scenario, trial, stderr } satisfies Failure;
    failures.push(failure);
    yield* Console.log(yield* encodeJson(failure));
  });

const runScenarios = Effect.gen(function* () {
  for (let trial = 0; trial < trials; trial++) {
    for (const scenario of scenarios) {
      const offset = trial % modes.length;
      const trialModes = [...modes.slice(offset), ...modes.slice(0, offset)];
      for (const mode of trialModes) yield* runScenario(mode, scenario, trial);
    }
  }
});

const summarize = () =>
  scenarios.flatMap((scenario) =>
    modes.map((mode) => {
      const selected = results.filter(
        (result) => result.scenario === scenario && result.mode === mode,
      );
      const values: Record<
        string,
        { median: number | null; range: readonly [number, number] | null }
      > = {};
      for (const metric of metrics) {
        const samples = selected.map((result) => result[metric]);
        values[metric] = { median: median(samples), range: range(samples) };
      }
      return { scenario, mode, metrics: values };
    }),
  );
const output = `${tmpdir()}/chord-delta-memory-benchmark.json`;
await Effect.runPromise(
  Effect.gen(function* () {
    yield* runScenarios;
    const summary = summarize();
    const report = {
      node: process.version,
      size,
      updates,
      watchCount,
      trials,
      results,
      failures,
      summary,
    };
    yield* writeText(output, yield* encodePrettyJson(report));
    yield* Console.log(
      yield* encodeJson({
        output,
        node: process.version,
        size,
        updates,
        watchCount,
        trials,
        failures: failures.length,
        summary,
      }),
    );
  }),
);
