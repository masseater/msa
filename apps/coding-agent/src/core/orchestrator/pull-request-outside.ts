import { Effect, Option } from "effect";
import * as Schema from "effect/Schema";

import pullRequestProblems from "./pull-request-problems.ts";
import type runtimeTypes from "./runtime.types.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { short } = pullRequestProblems;

const MergedBy = Schema.fromJsonString(
  Schema.Struct({
    mergeCommit: Schema.NullOr(Schema.Struct({ oid: Schema.String })).pipe(Schema.optionalKey),
    mergedAt: Schema.NullOr(Schema.String).pipe(Schema.optionalKey),
    mergedBy: Schema.NullOr(Schema.Struct({ login: Schema.String })).pipe(Schema.optionalKey),
  }),
);

type PullRequest = orchestratorTypesTypes.PullRequest;

type Merger = "harness" | "outside" | "unconfirmed";

function mergedBy(record: PullRequest): Merger | undefined {
  if (record.state !== "MERGED") return undefined;
  if (record.harnessCommit !== null) return "harness";
  if (record.harnessMerge !== null) return "unconfirmed";
  return "outside";
}

function autoMergeLine(
  task: orchestratorTypesTypes.Task,
  record: PullRequest,
  enabledBy: string,
): string {
  return `PR #${record.number} (${record.branch}) has auto-merge enabled by ${enabledBy}, so GitHub would merge it without the harness and ${task.id} is stopped. Only the harness merges a task's pull request, after the review passes on the head it checked; disable auto-merge (gh pr merge ${record.number} --disable-auto) and decide what to do with the task.`;
}

function outsideMergeLine(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  cwd: string,
  record: PullRequest,
): Effect.Effect<string> {
  return Effect.gen(function* () {
    const result = yield* Effect.promise(() =>
      runtime.options
        .runGh(
          ["pr", "view", String(record.number), "--json", "mergedBy,mergeCommit,mergedAt"],
          cwd,
        )
        .catch((error: unknown) => ({ code: 1, stderr: String(error), stdout: "" })),
    );
    const merged =
      result.code === 0
        ? Option.getOrUndefined(Schema.decodeOption(MergedBy)(result.stdout))
        : undefined;
    const login = merged?.mergedBy?.login;
    const commit = merged?.mergeCommit?.oid ?? record.mergeCommit ?? undefined;
    const who = login ?? "an account gh did not name";
    const as = commit === undefined ? "an unknown merge commit" : `merge commit ${short(commit)}`;
    const when =
      merged?.mergedAt === undefined || merged.mergedAt === null ? "" : ` at ${merged.mergedAt}`;
    const why =
      result.code === 0 ? "" : ` (gh pr view failed: ${(result.stderr || result.stdout).trim()})`;
    const decide = `Only the harness merges a task's pull request, after the review passes on the head it checked; check what reached ${record.base} and decide what to do with the task.`;
    if (mergedBy(record) === "unconfirmed") {
      return `PR #${record.number} (${record.branch}) was merged by ${who} as ${as}${when}${why}, but GitHub never confirmed the harness's own merge of head ${short(record.harnessMerge ?? record.headSha)}, so the harness cannot tell that this merge is its own and ${task.id} is stopped, not completed. ${decide}`;
    }
    return `PR #${record.number} (${record.branch}) was merged by ${who} as ${as}${when}${why}, not by the harness, so ${task.id} is stopped, not completed. ${decide}`;
  });
}

function outsideLine(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  cwd: string,
  record: PullRequest,
  autoMergeBy: string | undefined,
): Effect.Effect<string | undefined> {
  return Effect.gen(function* () {
    const by = mergedBy(record);
    if (by === "outside" || by === "unconfirmed") {
      return yield* outsideMergeLine(runtime, task, cwd, record);
    }
    return autoMergeBy === undefined ? undefined : autoMergeLine(task, record, autoMergeBy);
  });
}

const pullRequestOutside = { autoMergeLine, mergedBy, outsideLine, outsideMergeLine };

export default pullRequestOutside;
