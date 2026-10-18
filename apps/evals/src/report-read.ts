import type { ReportCase } from "@vitest-evals/core";
import { readReportWorkspace, readVitestJsonReportFile } from "@vitest-evals/core/node";
import { Effect } from "effect";

import type { EvalTask } from "./plan.ts";
import { files, pathOperations, sha256Hex } from "./platform.ts";
import {
  type EvalMetrics,
  type EvalObservation,
  type EvalRunIdentity,
  MSA_SESSION_SNAPSHOT_ARTIFACT,
} from "./report-types.ts";

type LoadedReport = {
  workspace: Awaited<ReturnType<typeof readReportWorkspace>>["workspace"];
  rawReport: Awaited<ReturnType<typeof readVitestJsonReportFile>>;
};

type SelectedCase =
  | { kind: "done"; observation: EvalObservation }
  | {
      kind: "case";
      caseResult: ReportCase;
      run: NonNullable<NonNullable<ReportCase["harness"]>["run"]>;
      statusOutcome: ReturnType<typeof classifyCaseStatus>;
    };

function optionalMetric(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a finite non-negative number.`);
  }
  return value;
}

function validateScore(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError("Eval score must be between 0 and 1.");
  }
  return value;
}

export function classifyCaseStatus(
  status: ReportCase["status"],
): "errored" | "skipped" | "pending" | undefined {
  if (status === "failed") return "errored";
  if (status === "skipped" || status === "todo" || status === "disabled") return "skipped";
  if (status === "pending") return "pending";
  return undefined;
}

function taskIdentity(task: EvalTask): EvalRunIdentity {
  return {
    evalSet: task.evalSet,
    caseId: task.caseId,
    variant: task.variant,
    model: task.model,
    runNumber: task.runNumber,
  };
}

export function erroredObservation(task: EvalTask): EvalObservation {
  return { ...taskIdentity(task), outcome: "errored" };
}

function sessionDigestInput(task: EvalTask): string {
  return JSON.stringify([task.evalSet, task.caseId, task.variant, task.model, task.runNumber]);
}

const persistSession = (
  caseResult: ReportCase,
  task: EvalTask,
  artifactDirectory: string,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const session = caseResult.harness?.run?.artifacts?.[MSA_SESSION_SNAPSHOT_ARTIFACT];
    if (typeof session !== "string") return;
    const digest = yield* sha256Hex(sessionDigestInput(task));
    const directory = pathOperations.join(artifactDirectory, task.variant, "sessions", digest);
    yield* files.makeDirectory(directory, 0o700);
    yield* files.writeFileString(pathOperations.join(directory, "session.jsonl"), session, 0o600);
  });

const loadReport = (reportPath: string): Effect.Effect<LoadedReport | undefined> =>
  Effect.promise(() =>
    Promise.all([readReportWorkspace([reportPath]), readVitestJsonReportFile(reportPath)]).then(
      ([{ workspace }, rawReport]): LoadedReport => ({ workspace, rawReport }),
      () => undefined,
    ),
  );

function selectCase(task: EvalTask, loaded: LoadedReport): SelectedCase {
  const identity = taskIdentity(task);
  const errored: SelectedCase = { kind: "done", observation: { ...identity, outcome: "errored" } };
  const reportsTask = (fullName: string): boolean =>
    fullName === task.caseId || fullName.endsWith(` ${task.caseId}`);
  const assertions = loaded.rawReport.testResults.flatMap(
    ({ assertionResults }) => assertionResults,
  );
  const assertion = assertions.length === 1 ? assertions[0] : undefined;
  if (assertion === undefined || !reportsTask(assertion.fullName)) return errored;
  const statusOutcome = classifyCaseStatus(assertion.status);
  if (statusOutcome === "skipped" || statusOutcome === "pending") {
    return { kind: "done", observation: { ...identity, outcome: statusOutcome } };
  }
  const caseResult = loaded.workspace.cases.length === 1 ? loaded.workspace.cases[0] : undefined;
  if (
    caseResult === undefined ||
    !reportsTask(caseResult.fullName) ||
    caseResult.status !== assertion.status
  ) {
    return errored;
  }
  const run = caseResult.harness?.run;
  if (run === undefined) return errored;
  return { kind: "case", caseResult, run, statusOutcome };
}

function readMetrics(run: NonNullable<ReportCase["harness"]>["run"]): EvalMetrics {
  return {
    inputTokens: optionalMetric(run?.usage.inputTokens, "inputTokens"),
    outputTokens: optionalMetric(run?.usage.outputTokens, "outputTokens"),
    cacheReadTokens: optionalMetric(run?.usage.metadata?.["cacheReadTokens"], "cacheReadTokens"),
    cacheWriteTokens: optionalMetric(run?.usage.metadata?.["cacheWriteTokens"], "cacheWriteTokens"),
    totalTokens: optionalMetric(run?.usage.totalTokens, "totalTokens"),
    toolCalls: optionalMetric(run?.usage.toolCalls, "toolCalls"),
    totalMs: optionalMetric(run?.timings?.totalMs, "totalMs"),
    estimatedCostUsd: optionalMetric(run?.usage.metadata?.["estimatedCostUsd"], "estimatedCostUsd"),
  };
}

function actualModelOf(run: NonNullable<ReportCase["harness"]>["run"]): string | undefined {
  const provider = run?.usage.provider;
  const model = run?.usage.model;
  const present = (value: string | undefined): value is string =>
    value !== undefined && value !== "";
  return present(provider) && present(model) ? `${provider}/${model}` : undefined;
}

function observeRun(
  task: EvalTask,
  selected: Extract<SelectedCase, { kind: "case" }>,
): EvalObservation {
  const identity = taskIdentity(task);
  const { caseResult, run, statusOutcome } = selected;
  if (actualModelOf(run) !== task.model) return { ...identity, outcome: "errored" };
  let metrics: EvalMetrics;
  try {
    metrics = readMetrics(run);
  } catch {
    return { ...identity, outcome: "errored" };
  }
  if (statusOutcome === "errored" || run.errors.length > 0) {
    return { ...identity, ...metrics, outcome: "errored" };
  }
  let score: number | undefined;
  try {
    score = validateScore(caseResult.eval?.avgScore);
  } catch {
    return { ...identity, ...metrics, outcome: "errored" };
  }
  if (score === undefined) return { ...identity, ...metrics, outcome: "unscored" };
  return { ...identity, ...metrics, outcome: "scored", score };
}

export const readTaskObservation = ({
  task,
  reportPath,
  artifactDirectory,
}: {
  task: EvalTask;
  reportPath: string;
  artifactDirectory: string;
}): Effect.Effect<EvalObservation> =>
  Effect.gen(function* () {
    const loaded = yield* loadReport(reportPath);
    if (loaded === undefined) return erroredObservation(task);
    const selected = selectCase(task, loaded);
    if (selected.kind === "done") return selected.observation;
    yield* persistSession(selected.caseResult, task, artifactDirectory);
    return observeRun(task, selected);
  });
