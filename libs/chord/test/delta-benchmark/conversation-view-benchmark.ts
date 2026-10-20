import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { Console, Effect, Exit } from "effect";

import benchmarkModule from "../fixtures/benchmark.ts";
import platform from "../fixtures/platform.ts";
import conversationViewModel from "./conversation-view-model.ts";
import type conversationViewModelTypes from "./conversation-view-model.types.ts";

const { decodeJson, encodeJson, encodePrettyJson } = benchmarkModule;
const { runNode, writeText } = platform;
const { PROVISIONAL_SCHEMA, modes, numericMetrics, phaseNames, scenarios } = conversationViewModel;

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

function summarize(values: readonly number[]): conversationViewModelTypes.SummaryValue {
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
  selectedScenario === undefined
    ? scenarios
    : [selectedScenario as conversationViewModelTypes.Scenario];
const headlineEntries = optionNumber("entries", quick ? 128 : 512);
const commits = optionNumber("commits", quick ? 120 : 1_000);
const trials = optionNumber("trials", quick ? 1 : 3);
const queueOperationCapacity = quick ? 64 : 256;
const root = fileURLToPath(new URL("../../../..", import.meta.url));
const worker = fileURLToPath(new URL("./conversation-view-benchmark.worker.ts", import.meta.url));
const results: conversationViewModelTypes.Result[] = [];
const failures: conversationViewModelTypes.Failure[] = [];

const runScenario = (
  mode: conversationViewModelTypes.Mode,
  scenario: conversationViewModelTypes.Scenario,
  trial: number,
) =>
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
      const result = (yield* decodeJson(exit.value.stdout)) as conversationViewModelTypes.Result;
      results.push(result);
      yield* Console.log(yield* encodeJson(result));
      return;
    }
    const stderr = Exit.isSuccess(exit) ? exit.value.stderr : String(exit.cause);
    const failure = { mode, scenario, stderr, trial } satisfies conversationViewModelTypes.Failure;
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
      const metrics: Record<string, conversationViewModelTypes.SummaryValue> = {};
      for (const metric of numericMetrics)
        metrics[metric] = summarize(selected.map((result) => result[metric]));
      const phases: Record<
        string,
        {
          medianMs: conversationViewModelTypes.SummaryValue;
          p95Ms: conversationViewModelTypes.SummaryValue;
          p99Ms: conversationViewModelTypes.SummaryValue;
          totalMs: conversationViewModelTypes.SummaryValue;
        }
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
        conversationWatchCount: selected[0]?.conversationWatchCount ?? 0,
        deliveryModel: "async-serialized-ops-only-no-consumer-apply",
        documentWatchCount: selected[0]?.documentWatchCount ?? 0,
        metrics,
        mode,
        phases,
        provisionalSchema: PROVISIONAL_SCHEMA,
        queueCapacity: selected[0]?.queueCapacity ?? null,
        queueCapacityUnit: "pending-operations",
        scenario,
      };
    }),
  );

const output = `${tmpdir()}/chord-conversation-view-benchmark.json`;
void Effect.runPromise(
  Effect.gen(function* () {
    yield* runScenarios;
    const summary = summarizeAll();
    const report = {
      commits,
      failures,
      headlineEntries,
      node: process.version,
      profile: "local-pico5-provisional-conversation-view",
      provisionalSchema: PROVISIONAL_SCHEMA,
      queueOperationCapacity,
      results,
      summary,
      trials,
    };
    yield* writeText(output, yield* encodePrettyJson(report));
    yield* Console.log(
      yield* encodeJson({
        commits,
        failures: failures.length,
        headlineEntries,
        node: process.version,
        output,
        provisionalSchema: PROVISIONAL_SCHEMA,
        queueOperationCapacity,
        summary,
        trials,
      }),
    );
  }),
);
