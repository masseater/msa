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

type MergeAttempt = orchestratorTypesTypes.MergeAttempt;

function unmerged(
  number: number,
  attempt: MergeAttempt,
  after: PullRequest | undefined,
): MergeOutcome {
  const why =
    attempt.kind === "merged"
      ? `#${number} is still ${after?.state.toLowerCase() ?? "unread"}`
      : attempt.why;
  return {
    kind: "stopped",
    line: `The review passed, but the harness could not merge PR #${number}, so the task is stopped, not completed: ${why}`,
  };
}

function landed(
  runtime: runtimeTypes.Runtime,
  read: PullRequest,
  commit: string,
  now: number,
): PullRequest {
  if (read.state === "MERGED" && read.mergeCommit !== null) return read;
  store.savePullRequest(
    runtime.database,
    { ...read, checkedAt: now, mergeCommit: commit, state: "MERGED" },
    true,
  );
  runtime.publish();
  return store.pullRequestOf(runtime.database, read.taskId) ?? read;
}

function squash(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  ready: Ready,
): Effect.Effect<MergeOutcome> {
  return Effect.gen(function* () {
    const { owner, record, verified } = ready;
    const [attempt, after] = yield* Effect.uninterruptible(
      Effect.gen(function* () {
        store.markHarnessMerge(runtime.database, task.id, verified.sha);
        const tried = yield* pullRequests.merge(runtime, owner.cwd, record.number, verified);
        if (tried.kind === "merged") {
          store.markHarnessCommit(runtime.database, task.id, tried.commit);
        }
        if (tried.kind === "refused") store.markHarnessMerge(runtime.database, task.id, null);
        const read = yield* Effect.result(pullRequests.view(runtime, owner.cwd, record.number));
        return [tried, read] as const;
      }),
    );
    const now = yield* nowMillis;
    const read = Result.isSuccess(after)
      ? pullRequests.save(runtime, task.id, after.success, verified, now)
      : undefined;
    const saved =
      attempt.kind === "merged"
        ? landed(runtime, read ?? { ...record, harnessCommit: attempt.commit }, attempt.commit, now)
        : read;
    if (saved !== undefined) {
      const settled = yield* settleMerged(
        runtime,
        task,
        owner.cwd,
        saved,
        `Squash-merged PR #${saved.number} at head ${short(verified.sha)} as merge commit ${short(saved.mergeCommit ?? "")}.`,
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
    return unmerged(record.number, attempt, read);
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
