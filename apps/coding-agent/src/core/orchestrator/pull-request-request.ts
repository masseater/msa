import { Effect, Result } from "effect";

import type goalCheckTextTypes from "./goal-check-text.types.ts";
import pullRequestProblems from "./pull-request-problems.ts";
import pullRequestSquashModule from "./pull-request-squash.ts";
import pullRequestsModule from "./pull-requests.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { pullRequests } = pullRequestsModule;
const { pullRequestSquash } = pullRequestSquashModule;
const { problemsOf, short } = pullRequestProblems;
const { store } = storeModule;

type PullRequest = orchestratorTypesTypes.PullRequest;
type Verified = orchestratorTypesTypes.VerifiedPullRequest;
type MergeAttempt = orchestratorTypesTypes.MergeAttempt;
type PullView = Parameters<typeof pullRequestsModule.pullRequests.verifiedOf>[0];
type Problem = goalCheckTextTypes.Problem;

interface MergeMarks {
  requested(nonce: string, sha: string): void;
  accepted(commit: string): void;
  refused(): void;
}

interface Requested {
  tried: MergeAttempt;
  read: Result.Result<PullView, runtimeTypes.OrchestratorError> | undefined;
}

function storeMarks(runtime: runtimeTypes.Runtime, taskId: string): MergeMarks {
  return {
    accepted: (commit) => store.markHarnessCommit(runtime.database, taskId, commit),
    refused: () => store.markHarnessMerge(runtime.database, taskId, null),
    requested: (nonce, sha) => store.markHarnessMerge(runtime.database, taskId, { nonce, sha }),
  };
}

function changedSinceReview(number: number, now: Verified, verified: Verified | null): string[] {
  const name = `#${number}`;
  if (verified === null) {
    return [
      `The goal check never passed on ${name}, so the reviewer did not read it. End your turn again so it is checked and reviewed.`,
    ];
  }
  const changed = [
    ...(verified.sha === now.sha
      ? []
      : [`its head moved from ${short(verified.sha)} to ${short(now.sha)}`]),
    ...(verified.title === now.title ? [] : ["its title changed"]),
    ...(verified.body === now.body ? [] : ["its body changed"]),
  ];
  if (changed.length === 0) return [];
  return [
    `${name} changed after the review (${changed.join(", ")}), so the reviewed pull request is not the one that would merge. Make the title and body describe the final diff, then end your turn so it is checked and reviewed again.`,
  ];
}

function readiness(
  runtime: runtimeTypes.Runtime,
  record: PullRequest,
  pull: PullView,
  verified: Verified | null,
  now: number,
): { fixes: string[]; problems: Problem[] } {
  const problems = problemsOf(record, undefined, pullRequests.awaitingChecks(runtime, record, now));
  return {
    fixes: [
      ...problems.filter((problem) => problem.kind === "fix").map((problem) => problem.text),
      ...changedSinceReview(record.number, pullRequests.verifiedOf(pull), verified),
    ],
    problems,
  };
}

function request(
  runtime: runtimeTypes.Runtime,
  cwd: string,
  number: number,
  verified: Verified,
  marks: MergeMarks,
): Effect.Effect<Requested> {
  return Effect.gen(function* () {
    const gh = pullRequestSquash.ghOf(runtime, cwd);
    const prepared = yield* Effect.result(pullRequestSquash.prepare(gh, number, verified));
    if (Result.isFailure(prepared)) {
      return { read: undefined, tried: { kind: "refused", why: prepared.failure } };
    }
    const { nonce, squashed } = prepared.success;
    return yield* Effect.uninterruptible(
      Effect.gen(function* () {
        marks.requested(nonce, verified.sha);
        const tried = yield* pullRequestSquash.merge(gh, number, verified.sha, squashed);
        if (tried.kind === "merged") marks.accepted(tried.commit);
        if (tried.kind === "refused") marks.refused();
        const read = yield* Effect.result(pullRequests.view(runtime, cwd, number));
        return { read, tried };
      }),
    );
  });
}

const pullRequestRequest = { changedSinceReview, readiness, request, storeMarks };

export default pullRequestRequest;
