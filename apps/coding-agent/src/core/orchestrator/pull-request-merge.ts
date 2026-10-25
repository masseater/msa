import { Effect, Result } from "effect";

import pullRequestFinish from "./pull-request-finish.ts";
import pullRequestOutside from "./pull-request-outside.ts";
import pullRequestProblems from "./pull-request-problems.ts";
import pullRequestsModule from "./pull-requests.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { pullRequests } = pullRequestsModule;
const { problemsOf, short } = pullRequestProblems;
const { settleMerged } = pullRequestFinish;
const { autoMergeLine } = pullRequestOutside;
const { store } = storeModule;
const { nowMillis } = runtimeModule;

type MergeOutcome = runtimeTypes.MergeOutcome;
type PullRequest = orchestratorTypesTypes.PullRequest;
type Verified = orchestratorTypesTypes.VerifiedPullRequest;

function sendBack(problems: readonly string[], number: number | null): MergeOutcome {
  const name = number === null ? "the pull request" : `PR #${number}`;
  return {
    kind: "sent-back",
    line: `The review passed, but the harness cannot merge ${name} yet, so the task goes back to the worker: ${problems.join(" ")}`,
    prompt: [
      "<merge-blocked>",
      `The reviewer passed this work, but the harness could not merge ${name}. Fix the following; the work is checked and reviewed again after them.`,
      ...problems.map((problem) => `- ${problem}`),
      "</merge-blocked>",
    ].join("\n"),
  };
}

interface Ready {
  owner: { branch: string; base: string; cwd: string };
  record: PullRequest;
  verified: Verified;
}

type Attempt<A> = Result.Result<A, runtimeTypes.OrchestratorError>;

function unmerged(
  number: number,
  verified: Verified,
  merging: Attempt<void>,
  after: Attempt<{ state: string }>,
): MergeOutcome {
  if (Result.isSuccess(merging) && Result.isFailure(after)) {
    return {
      kind: "stopped",
      line: `gh pr merge reported that PR #${number} was squash-merged at head ${short(verified.sha)}, but the harness could not read it back to confirm, so the task is stopped, not completed: ${after.failure.message} Rerun the task once gh can read the pull request; it completes if #${number} reads back as merged at that head.`,
    };
  }
  const why = Result.isFailure(merging)
    ? merging.failure.message
    : `#${number} is still ${Result.isSuccess(after) ? after.success.state.toLowerCase() : "unread"}`;
  return {
    kind: "stopped",
    line: `The review passed, but the harness could not merge PR #${number}, so the task is stopped, not completed: ${why}`,
  };
}

function squash(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  ready: Ready,
): Effect.Effect<MergeOutcome> {
  return Effect.gen(function* () {
    const { owner, record, verified } = ready;
    store.markHarnessMerge(runtime.database, task.id, verified.sha);
    const [merging, after] = yield* Effect.uninterruptible(
      Effect.all([
        Effect.result(pullRequests.merge(runtime, owner.cwd, record.number, verified)),
        Effect.result(pullRequests.view(runtime, owner.cwd, record.number)),
      ]),
    );
    if (Result.isFailure(merging) && Result.isFailure(after)) {
      store.markHarnessMerge(runtime.database, task.id, null);
    }
    if (Result.isSuccess(after)) {
      const now = yield* nowMillis;
      const saved = pullRequests.save(runtime, task.id, after.success, verified, now);
      const settled = yield* settleMerged(
        runtime,
        task,
        owner.cwd,
        saved,
        `Squash-merged PR #${saved.number} at head ${short(verified.sha)}.`,
      );
      if (settled !== undefined) return settled;
      const fixes = problemsOf(saved, undefined, false).filter((problem) => problem.kind === "fix");
      if (fixes.length > 0) {
        return blocked(
          runtime,
          task,
          saved,
          fixes.map((problem) => problem.text),
        );
      }
    }
    return unmerged(record.number, verified, merging, after);
  });
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

function blocked(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  record: PullRequest,
  problems: readonly string[],
): MergeOutcome {
  const previous = store.pullRequestOf(runtime.database, task.id)?.blockedHead ?? null;
  if (previous !== record.headSha) {
    store.markBlockedHead(runtime.database, task.id, record.headSha);
    return sendBack(problems, record.number);
  }
  store.markBlockedHead(runtime.database, task.id, null);
  return {
    kind: "needs-decision",
    line: `The review passed, but the harness still cannot merge PR #${record.number} (${record.branch}), and its head ${short(record.headSha)} is the one the work was already sent back with for this, so the work is not moving and the task waits for a decision: ${problems.join(" ")} Decide how to proceed and answer with send_message; the worker continues with your answer.`,
    triage: true,
  };
}

function ciStalled(
  record: PullRequest,
  waitMs: number,
  problems: readonly { text: string }[],
): MergeOutcome {
  return {
    kind: "needs-decision",
    line: `The review passed, but CI on PR #${record.number} (${record.branch}) has not finished for ${Math.round(waitMs / 60_000)} minutes, so the task waits for a decision: ${problems.map((problem) => problem.text).join(" ")} Find out why CI does not finish, then answer with send_message; the worker continues with your answer.`,
    triage: false,
  };
}

interface Read {
  owner: Ready["owner"];
  record: PullRequest;
  pull: Parameters<typeof pullRequests.verifiedOf>[0];
  verified: Verified | null;
}

function readPull(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  owner: Ready["owner"],
): Effect.Effect<Read | MergeOutcome> {
  return Effect.gen(function* () {
    const recorded = store.pullRequestOf(runtime.database, task.id);
    const found = yield* Effect.result(pullRequests.current(runtime, owner));
    if (Result.isFailure(found)) {
      return {
        kind: "stopped",
        line: `The review passed, but the harness could not read the pull request of ${owner.branch}, so the task is stopped, not completed: ${found.failure.message}`,
      };
    }
    const pull = found.success;
    if (pull === undefined) {
      return sendBack(
        [
          `No pull request has ${owner.branch} as its head. Push it and open one into ${owner.base}.`,
        ],
        null,
      );
    }
    const verified = recorded?.number === pull.number ? recorded.verified : null;
    const record = pullRequests.save(runtime, task.id, pull, verified, yield* nowMillis);
    return { owner, pull, record, verified };
  });
}

function afterReview(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
): Effect.Effect<MergeOutcome | undefined> {
  return Effect.gen(function* () {
    const owner = yield* pullRequests.ownerOf(runtime, task);
    if (owner === undefined) return undefined;
    const { pollMs, waitMs } = pullRequests.ciTiming(runtime);
    const since = yield* nowMillis;
    for (;;) {
      const got = yield* readPull(runtime, task, owner);
      if ("kind" in got) return got;
      const { pull, record, verified } = got;
      const autoMergeBy = pullRequests.autoMergeBy(pull);
      const settled = yield* settleMerged(
        runtime,
        task,
        owner.cwd,
        record,
        `PR #${record.number} was already merged.`,
      );
      if (settled !== undefined) return settled;
      if (autoMergeBy !== undefined) {
        return { kind: "stopped", line: autoMergeLine(task, record, autoMergeBy) };
      }
      const now = yield* nowMillis;
      const changed = changedSinceReview(record.number, pullRequests.verifiedOf(pull), verified);
      const problems = problemsOf(
        record,
        undefined,
        pullRequests.awaitingChecks(runtime, record, now),
      );
      const fixes = [
        ...problems.filter((problem) => problem.kind === "fix").map((problem) => problem.text),
        ...changed,
      ];
      if (fixes.length > 0) return blocked(runtime, task, record, fixes);
      if (problems.length === 0 && verified !== null) {
        return yield* squash(runtime, task, { owner, record, verified });
      }
      if (now - since >= waitMs) return ciStalled(record, waitMs, problems);
      yield* Effect.sleep(pollMs);
    }
  });
}

const pullRequestMerge = { afterInterrupt: pullRequestFinish.afterInterrupt, afterReview };

const pullRequestMergeModule = { pullRequestMerge };

export default pullRequestMergeModule;
