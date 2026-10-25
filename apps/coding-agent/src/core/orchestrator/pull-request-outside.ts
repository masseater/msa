import { Effect, Option, Result } from "effect";
import * as Schema from "effect/Schema";

import pullRequestProblems from "./pull-request-problems.ts";
import pullRequestSquashModule from "./pull-request-squash.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { short } = pullRequestProblems;
const { pullRequestSquash } = pullRequestSquashModule;
const { store } = storeModule;

const MergedBy = Schema.fromJsonString(
  Schema.Struct({
    mergeCommit: Schema.NullOr(Schema.Struct({ oid: Schema.String })).pipe(Schema.optionalKey),
    mergedAt: Schema.NullOr(Schema.String).pipe(Schema.optionalKey),
    mergedBy: Schema.NullOr(Schema.Struct({ login: Schema.String })).pipe(Schema.optionalKey),
  }),
);

type PullRequest = orchestratorTypesTypes.PullRequest;

type Judgement =
  | { by: "harness"; record: PullRequest }
  | { by: "outside" | "unread"; record: PullRequest; reason: string };

function judgeMerge(
  runtime: runtimeTypes.Runtime,
  cwd: string,
  record: PullRequest,
): Effect.Effect<Judgement | undefined> {
  return Effect.gen(function* () {
    if (record.state !== "MERGED") return undefined;
    const { harnessCommit, harnessNonce, mergeCommit } = record;
    if (harnessCommit !== null && (mergeCommit === null || mergeCommit === harnessCommit)) {
      return { by: "harness", record };
    }
    if (harnessCommit !== null) {
      return {
        by: "outside",
        reason: `GitHub answered the harness's merge request with merge commit ${short(harnessCommit)}, but the pull request was merged as ${short(mergeCommit ?? "")}`,
        record,
      };
    }
    if (harnessNonce === null) {
      return {
        by: "outside",
        reason:
          "the harness had no merge request of its own pending for this pull request: it had sent none, or GitHub refused the one it sent",
        record,
      };
    }
    if (mergeCommit === null) {
      return { by: "unread", reason: "gh did not report the merge commit", record };
    }
    const message = yield* Effect.result(
      pullRequestSquash.commitMessage(runtime, cwd, mergeCommit),
    );
    if (Result.isFailure(message)) {
      return { by: "unread", reason: message.failure, record };
    }
    if (!pullRequestSquash.carriesNonce(message.success, harnessNonce)) {
      return {
        by: "outside",
        reason: `the message of merge commit ${short(mergeCommit)} does not carry the trailer ${pullRequestSquash.trailerOf(harnessNonce)} that the harness put in its own merge request`,
        record,
      };
    }
    store.markHarnessCommit(runtime.database, record.taskId, mergeCommit);
    runtime.publish();
    return { by: "harness", record: { ...record, harnessCommit: mergeCommit } };
  });
}

function autoMergeLine(
  task: orchestratorTypesTypes.Task,
  record: PullRequest,
  enabledBy: string,
): string {
  return `PR #${record.number} (${record.branch}) has auto-merge enabled by ${enabledBy}, so GitHub would merge it without the harness and ${task.id} is stopped. Only the harness merges a task's pull request, after the review passes on the head it checked; disable auto-merge (gh pr merge ${record.number} --disable-auto) and decide what to do with the task.`;
}

function mergeFacts(
  runtime: runtimeTypes.Runtime,
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
    const as = commit === undefined ? "an unknown merge commit" : `merge commit ${short(commit)}`;
    const when =
      merged?.mergedAt === undefined || merged.mergedAt === null ? "" : ` at ${merged.mergedAt}`;
    const account =
      login === undefined
        ? "gh did not name the account GitHub recorded for the merge"
        : `GitHub recorded the merge under the account ${login}, which can be the account the harness itself uses`;
    const failed =
      result.code === 0 ? "" : ` (gh pr view failed: ${(result.stderr || result.stdout).trim()})`;
    return `PR #${record.number} (${record.branch}) was merged as ${as}${when}; ${account}${failed}.`;
  });
}

function outsideMergeLine(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  cwd: string,
  judged: Exclude<Judgement, { by: "harness" }>,
): Effect.Effect<string> {
  return Effect.gen(function* () {
    const { record, reason } = judged;
    const facts = yield* mergeFacts(runtime, cwd, record);
    if (judged.by === "unread") {
      return `${facts} The harness could not read that merge commit to compare it with its own merge request: ${reason}. It has not judged the merge to be someone else's, but it cannot confirm it as its own either, so ${task.id} is stopped, not completed. Rerun the task once gh can read the commit; it completes if the merge commit carries the harness's trailer.`;
    }
    return `${facts} The harness judged from its own record, not from that account, that it did not make this merge: ${reason}. So ${task.id} is stopped, not completed. Only the harness merges a task's pull request, after the review passes on the head it checked; check what reached ${record.base} and decide what to do with the task.`;
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
    const judged = yield* judgeMerge(runtime, cwd, record);
    if (judged !== undefined && judged.by !== "harness") {
      return yield* outsideMergeLine(runtime, task, cwd, judged);
    }
    return autoMergeBy === undefined ? undefined : autoMergeLine(task, record, autoMergeBy);
  });
}

const pullRequestOutside = { autoMergeLine, judgeMerge, outsideLine, outsideMergeLine };

export default pullRequestOutside;
