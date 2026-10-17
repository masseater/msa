import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { Console, Effect, Exit } from "effect";

import { decodeJson, encodeJson, encodePrettyJson } from "../fixtures/benchmark.ts";
import { runNode, writeText } from "../fixtures/platform.ts";
import {
  type Failure,
  type Mode,
  modes,
  numericMetrics,
  phaseNames,
  PROVISIONAL_SCHEMA,
  type Result,
  type Scenario,
  scenarios,
  type SummaryValue,
} from "./conversation-view-model.ts";

function optionNumber(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const raw = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid --${name}`);
  return value;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)]!;
}

function range(values: readonly number[]): readonly [number, number] | null {
  return values.length === 0 ? null : [Math.min(...values), Math.max(...values)];
}

function summarize(values: readonly number[]): SummaryValue {
  return { median: median(values), range: range(values) };
}

const quick = process.argv.includes("--quick");
const selectedScenario = process.argv
  .find((argument) => argument.startsWith("--scenario="))
  ?.slice("--scenario=".length);
if (
  selectedScenario !== undefined &&
  !(scenarios as readonly string[]).includes(selectedScenario)
) {
  throw new Error(`Unknown scenario ${selectedScenario}`);
}
const selectedScenarios =
  selectedScenario === undefined ? scenarios : [selectedScenario as Scenario];
const headlineEntries = optionNumber("entries", quick ? 128 : 512);
const commits = optionNumber("commits", quick ? 120 : 1_000);
const trials = optionNumber("trials", quick ? 1 : 3);
const queueOperationCapacity = quick ? 64 : 256;
const root = fileURLToPath(new URL("../../../..", import.meta.url));
const worker = fileURLToPath(new URL("./conversation-view-benchmark.worker.ts", import.meta.url));
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
          String(headlineEntries),
          String(commits),
          String(trial),
          String(queueOperationCapacity),
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
    for (const scenario of selectedScenarios) {
      const offset = trial % modes.length;
      const trialModes = [...modes.slice(offset), ...modes.slice(0, offset)];
      for (const mode of trialModes) yield* runScenario(mode, scenario, trial);
    }
  }
});

const summarizeAll = () =>
  selectedScenarios.flatMap((scenario) =>
    modes.map((mode) => {
      const selected = results.filter(
        (result) => result.scenario === scenario && result.mode === mode,
      );
      const metrics: Record<string, SummaryValue> = {};
      for (const metric of numericMetrics)
        metrics[metric] = summarize(selected.map((result) => result[metric]));
      const phases: Record<
        string,
        { medianMs: SummaryValue; p95Ms: SummaryValue; p99Ms: SummaryValue; totalMs: SummaryValue }
      > = {};
      for (const phase of phaseNames) {
        phases[phase] = {
          medianMs: summarize(selected.map((result) => result.phaseDistributions[phase].medianMs)),
          p95Ms: summarize(selected.map((result) => result.phaseDistributions[phase].p95Ms)),
          p99Ms: summarize(selected.map((result) => result.phaseDistributions[phase].p99Ms)),
          totalMs: summarize(selected.map((result) => result.phaseDistributions[phase].totalMs)),
        };
      }
      return {
        mode,
        scenario,
        provisionalSchema: PROVISIONAL_SCHEMA,
        conversationWatchCount: selected[0]?.conversationWatchCount ?? 0,
        documentWatchCount: selected[0]?.documentWatchCount ?? 0,
        queueCapacity: selected[0]?.queueCapacity ?? null,
        queueCapacityUnit: "pending-operations",
        deliveryModel: "async-serialized-ops-only-no-consumer-apply",
        metrics,
        phases,
      };
    }),
  );

const output = `${tmpdir()}/chord-conversation-view-benchmark.json`;
await Effect.runPromise(
  Effect.gen(function* () {
    yield* runScenarios;
    const summary = summarizeAll();
    const report = {
      node: process.version,
      provisionalSchema: PROVISIONAL_SCHEMA,
      profile: "local-pico5-provisional-conversation-view",
      headlineEntries,
      commits,
      trials,
      queueOperationCapacity,
      results,
      failures,
      summary,
    };
    yield* writeText(output, yield* encodePrettyJson(report));
    yield* Console.log(
      yield* encodeJson({
        output,
        node: process.version,
        provisionalSchema: PROVISIONAL_SCHEMA,
        headlineEntries,
        commits,
        trials,
        queueOperationCapacity,
        failures: failures.length,
        summary,
      }),
    );
  }),
);
