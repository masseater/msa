import { Effect } from "effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { parseDocument } from "yaml";

import type execTypes from "../exec.types.ts";
import type ciHistoryTypes from "./ci-history.types.ts";
import PrWatchGhError from "./pr-watch-gh-error.ts";

const RECENT_RUNS = 20;
const TYPICAL_PERCENTILE = 0.9;
const STALL_MARGIN = 1.5;
const MINUTE_MS = 60_000;
const DEFAULT_JOB_TIMEOUT_MINUTES = 360;

const GhRun = Schema.Struct({
  conclusion: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  name: Schema.NullOr(Schema.String),
  run_started_at: Schema.String.pipe(Schema.NullOr, Schema.optionalKey),
  updated_at: Schema.String,
});

const GhRunsJson = GhRun.pipe(Schema.Array, Schema.fromJsonString);

const WorkflowJob = Schema.Struct({
  needs: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  "timeout-minutes": Schema.optionalKey(Schema.Unknown),
});

const WorkflowFile = Schema.Struct({
  jobs: Schema.Record(Schema.String, WorkflowJob),
  name: Schema.optionalKey(Schema.Unknown),
});

function parseRuns(json: string): ciHistoryTypes.CiRun[] | undefined {
  const decoded = Schema.decodeOption(GhRunsJson)(json);
  if (Option.isNone(decoded)) return undefined;
  const runs: ciHistoryTypes.CiRun[] = [];
  for (const run of decoded.value) {
    const startedAt = run.run_started_at ?? run.created_at;
    const durationMs = Date.parse(run.updated_at) - Date.parse(startedAt);
    if (Number.isFinite(durationMs) && durationMs > 0) {
      runs.push({ durationMs, succeeded: run.conclusion === "success", workflow: run.name ?? "" });
    }
  }
  return runs;
}

function runsFrom(
  result: Pick<execTypes.ExecResult, "stdout">,
): Effect.Effect<readonly ciHistoryTypes.CiRun[], PrWatchGhError> {
  const runs = parseRuns(result.stdout);
  if (runs !== undefined) return Effect.succeed(runs);
  return Effect.fail(
    PrWatchGhError.make({
      kind: "other",
      message: "gh api actions/runs printed JSON this version cannot read",
    }),
  );
}

function jobMinutes(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_JOB_TIMEOUT_MINUTES;
}

function longestChainMinutes(jobs: Readonly<Record<string, typeof WorkflowJob.Type>>): number {
  const memo = new Map<string, number>();
  const byId = new Map(Object.entries(jobs));
  const visit = (id: string, path: ReadonlySet<string>): number => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    const job = byId.get(id);
    if (job === undefined || path.has(id)) return 0;
    const needs = job.needs === undefined ? [] : [job.needs].flat();
    const next = new Set(path).add(id);
    const before = Math.max(0, ...needs.map((need) => visit(need, next)));
    const total = before + jobMinutes(job["timeout-minutes"]);
    memo.set(id, total);
    return total;
  };
  return Math.max(0, ...[...byId.keys()].map((id) => visit(id, new Set())));
}

function workflowTimeout(path: string, text: string): ciHistoryTypes.WorkflowTimeout | undefined {
  const document = parseDocument(text);
  if (document.errors.length > 0) return undefined;
  const decoded = Schema.decodeUnknownOption(WorkflowFile)(document.toJS());
  if (Option.isNone(decoded)) return undefined;
  const minutes = longestChainMinutes(decoded.value.jobs);
  if (minutes === 0) return undefined;
  const name = decoded.value.name;
  return {
    timeoutMs: minutes * MINUTE_MS,
    workflow: typeof name === "string" && name !== "" ? name : path,
  };
}

function typicalOf(durations: readonly number[]): number {
  const sorted = durations.toSorted((a, b) => a - b);
  const rank = Math.ceil(TYPICAL_PERCENTILE * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)]!;
}

function successfulFirst(runs: readonly ciHistoryTypes.CiRun[]): readonly ciHistoryTypes.CiRun[] {
  const succeeded = runs.filter((run) => run.succeeded);
  return succeeded.length > 0 ? succeeded : runs;
}

function limitFromRuns(own: readonly ciHistoryTypes.CiRun[]): ciHistoryTypes.CiStallLimit {
  const typicalMs = typicalOf(own.map((run) => run.durationMs));
  return {
    basis: "history",
    limitMs: Math.round(typicalMs * STALL_MARGIN),
    runs: own.length,
    typicalMs,
  };
}

function limitFromTimeout(
  timeouts: readonly ciHistoryTypes.WorkflowTimeout[],
  workflow: string,
): ciHistoryTypes.CiStallLimit {
  const fallbackMs =
    timeouts.length > 0
      ? Math.max(...timeouts.map((timeout) => timeout.timeoutMs))
      : DEFAULT_JOB_TIMEOUT_MINUTES * MINUTE_MS;
  const timeoutMs =
    timeouts.find((timeout) => timeout.workflow === workflow)?.timeoutMs ?? fallbackMs;
  return { basis: "timeout", limitMs: Math.round(timeoutMs * STALL_MARGIN), timeoutMs };
}

function stallLimit(
  history: Pick<ciHistoryTypes.CiHistory, "runs" | "timeouts">,
  pendingWorkflows: readonly string[],
): ciHistoryTypes.CiStallLimit {
  const workflows = pendingWorkflows.length === 0 ? [""] : pendingWorkflows;
  return workflows
    .map((workflow) => {
      const own = successfulFirst(history.runs.filter((run) => run.workflow === workflow)).slice(
        0,
        RECENT_RUNS,
      );
      return own.length > 0 ? limitFromRuns(own) : limitFromTimeout(history.timeouts, workflow);
    })
    .reduce((a, b) => (b.limitMs > a.limitMs ? b : a));
}

const ciHistory = {
  runsFrom,
  stallLimit,
  workflowTimeout,
};

export default ciHistory;
