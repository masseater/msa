import { Effect } from "effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type execTypes from "../exec.types.ts";
import type ciHistoryTypes from "./ci-history.types.ts";
import PrWatchGhError from "./pr-watch-gh-error.ts";

const RECENT_RUNS = 20;
const TYPICAL_PERCENTILE = 0.9;
const STALL_MARGIN = 1.5;

const GhRun = Schema.Struct({
  conclusion: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  name: Schema.NullOr(Schema.String),
  updated_at: Schema.String,
});

const GhRunsJson = GhRun.pipe(Schema.Array, Schema.fromJsonString);

function parseRuns(json: string): ciHistoryTypes.CiRun[] | undefined {
  const decoded = Schema.decodeOption(GhRunsJson)(json);
  if (Option.isNone(decoded)) return undefined;
  const runs: ciHistoryTypes.CiRun[] = [];
  for (const run of decoded.value) {
    const durationMs = Date.parse(run.updated_at) - Date.parse(run.created_at);
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

function typicalOf(durations: readonly number[]): number {
  const sorted = durations.toSorted((a, b) => a - b);
  const rank = Math.ceil(TYPICAL_PERCENTILE * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)]!;
}

function stallLimit(
  runs: readonly ciHistoryTypes.CiRun[],
  pendingWorkflows: readonly string[],
): ciHistoryTypes.CiStallLimit | undefined {
  const succeeded = runs.filter((run) => run.succeeded);
  const pool = succeeded.length > 0 ? succeeded : runs;
  const anyWorkflow = pool.slice(0, RECENT_RUNS);
  if (anyWorkflow.length === 0) return undefined;
  const samples = (pendingWorkflows.length === 0 ? [""] : pendingWorkflows).map((workflow) => {
    const own = pool.filter((run) => run.workflow === workflow).slice(0, RECENT_RUNS);
    return own.length > 0 ? own : anyWorkflow;
  });
  const longest = samples
    .map((sample) => ({
      runs: sample.length,
      typicalMs: typicalOf(sample.map((run) => run.durationMs)),
    }))
    .reduce((a, b) => (b.typicalMs > a.typicalMs ? b : a));
  return { ...longest, limitMs: Math.round(longest.typicalMs * STALL_MARGIN) };
}

const ciHistory = {
  runsFrom,
  stallLimit,
};

export default ciHistory;
