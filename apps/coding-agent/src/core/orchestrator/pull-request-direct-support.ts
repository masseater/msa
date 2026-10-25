import { Effect } from "effect";

import errors from "./errors.ts";
import pullRequestProblems from "./pull-request-problems.ts";
import pullRequestRequest from "./pull-request-request.ts";
import pullRequestsModule from "./pull-requests.ts";
import type runtimeTypes from "./runtime.types.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { orchestratorError } = errors;
const { pullRequests } = pullRequestsModule;
const { short } = pullRequestProblems;
const { readiness } = pullRequestRequest;

type OrchestratorError = runtimeTypes.OrchestratorError;
type PullRequest = orchestratorTypesTypes.PullRequest;
type PullView = Parameters<typeof pullRequestsModule.pullRequests.verifiedOf>[0];
type MergeAttempt = orchestratorTypesTypes.MergeAttempt;

function failWith(text: string): Effect.Effect<never, OrchestratorError> {
  return Effect.fail(orchestratorError(text));
}

function refuse(number: number, why: string): Effect.Effect<never, OrchestratorError> {
  return failWith(`PR #${number} was not merged: ${why}`);
}

function readView(
  runtime: runtimeTypes.Runtime,
  cwd: string,
  number: number,
): Effect.Effect<PullView, OrchestratorError> {
  return Effect.mapError(pullRequests.view(runtime, cwd, number), (error) =>
    orchestratorError(`PR #${number} was not merged: ${error.message}`),
  );
}

function blockers(
  runtime: runtimeTypes.Runtime,
  record: PullRequest,
  pull: PullView,
  verified: orchestratorTypesTypes.VerifiedPullRequest,
  now: number,
): string[] {
  if (pull.headRefOid !== verified.sha) {
    return [
      `its head is ${short(pull.headRefOid)}, not the head ${short(verified.sha)} you named. Check the pull request at its current head, then name that head.`,
    ];
  }
  const autoMergeBy = pullRequests.autoMergeBy(pull);
  const { fixes, problems } = readiness(runtime, record, pull, verified, now);
  return [
    ...(autoMergeBy === undefined ? [] : [`auto-merge is enabled by ${autoMergeBy}.`]),
    ...fixes,
    ...problems.filter((problem) => problem.kind === "pending").map((problem) => problem.text),
  ];
}

function whyNot(attempt: MergeAttempt | undefined, state: string | undefined): string {
  if (attempt === undefined) return `it is ${state?.toLowerCase() ?? "unread"}.`;
  if (attempt.kind !== "merged") return attempt.why;
  return `GitHub answered with merge commit ${short(attempt.commit)}, but the pull request reads as ${state?.toLowerCase() ?? "unread"}.`;
}

const pullRequestDirectSupport = { blockers, failWith, readView, refuse, whyNot };

export default pullRequestDirectSupport;
