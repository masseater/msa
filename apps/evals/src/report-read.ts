import type { ReportCase } from "@vitest-evals/core";
import { readReportWorkspace, readVitestJsonReportFile } from "@vitest-evals/core/node";
import { Effect } from "effect";

import type planTypes from "./plan.types.ts";
import platform from "./platform.ts";
import reportTypes from "./report-types.ts";
import type reportTypesTypes from "./report-types.types.ts";

const { MSA_SESSION_SNAPSHOT_ARTIFACT } = reportTypes;
const { files, pathOperations, sha256Hex } = platform;

type LoadedReport = {
  workspace: Awaited<ReturnType<typeof readReportWorkspace>>["workspace"];
  rawReport: Awaited<ReturnType<typeof readVitestJsonReportFile>>;
};

type SelectedCase =
  | { kind: "done"; observation: reportTypesTypes.EvalObservation }
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

function classifyCaseStatus(
  status: ReportCase["status"],
): "errored" | "skipped" | "pending" | undefined {
  if (status === "failed") return "errored";
  if (status === "skipped" || status === "todo" || status === "disabled") return "skipped";
  if (status === "pending") return "pending";
  return undefined;
}

function taskIdentity(task: planTypes.EvalTask): reportTypesTypes.EvalRunIdentity {
  return {
    caseId: task.caseId,
    evalSet: task.evalSet,
    model: task.model,
    runNumber: task.runNumber,
    variant: task.variant,
  };
}

function erroredObservation(task: planTypes.EvalTask): reportTypesTypes.EvalObservation {
  return { ...taskIdentity(task), outcome: "errored" };
}

function sessionDigestInput(task: planTypes.EvalTask): string {
  return JSON.stringify([task.evalSet, task.caseId, task.variant, task.model, task.runNumber]);
}

const persistSession = (
  caseResult: ReportCase,
  task: planTypes.EvalTask,
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
      ([{ workspace }, rawReport]): LoadedReport => ({ rawReport, workspace }),
      () => undefined,
    ),
  );

function selectCase(task: planTypes.EvalTask, loaded: LoadedReport): SelectedCase {
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
  return { caseResult, kind: "case", run, statusOutcome };
}

function readMetrics(run: NonNullable<ReportCase["harness"]>["run"]): reportTypesTypes.EvalMetrics {
  return {
    cacheReadTokens: optionalMetric(run?.usage.metadata?.["cacheReadTokens"], "cacheReadTokens"),
    cacheWriteTokens: optionalMetric(run?.usage.metadata?.["cacheWriteTokens"], "cacheWriteTokens"),
    estimatedCostUsd: optionalMetric(run?.usage.metadata?.["estimatedCostUsd"], "estimatedCostUsd"),
    inputTokens: optionalMetric(run?.usage.inputTokens, "inputTokens"),
    outputTokens: optionalMetric(run?.usage.outputTokens, "outputTokens"),
    toolCalls: optionalMetric(run?.usage.toolCalls, "toolCalls"),
    totalMs: optionalMetric(run?.timings?.totalMs, "totalMs"),
    totalTokens: optionalMetric(run?.usage.totalTokens, "totalTokens"),
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
  task: planTypes.EvalTask,
  selected: Extract<SelectedCase, { kind: "case" }>,
): reportTypesTypes.EvalObservation {
  const identity = taskIdentity(task);
  const { caseResult, run, statusOutcome } = selected;
  if (actualModelOf(run) !== task.model) return { ...identity, outcome: "errored" };
  let metrics: reportTypesTypes.EvalMetrics;
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

const readTaskObservation = ({
  task,
  reportPath,
  artifactDirectory,
}: {
  task: planTypes.EvalTask;
  reportPath: string;
  artifactDirectory: string;
}): Effect.Effect<reportTypesTypes.EvalObservation> =>
  Effect.gen(function* () {
    const loaded = yield* loadReport(reportPath);
    if (loaded === undefined) return erroredObservation(task);
    const selected = selectCase(task, loaded);
    if (selected.kind === "done") return selected.observation;
    yield* persistSession(selected.caseResult, task, artifactDirectory);
    return observeRun(task, selected);
  });

const reportRead = {
  classifyCaseStatus,
  erroredObservation,
  readTaskObservation,
};

export default reportRead;
