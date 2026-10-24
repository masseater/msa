import { Effect, Result } from "effect";

import pullRequestProblems from "./pull-request-problems.ts";
import pullRequestsModule from "./pull-requests.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import schedule from "./schedule.ts";
import storeModule from "./store.ts";
import threadRun from "./thread-run.ts";
import type orchestratorTypesTypes from "./types.types.ts";
import worktreeModule from "./worktree.ts";

const { pullRequests } = pullRequestsModule;
const { problemsOf, short } = pullRequestProblems;
const { worktrees } = worktreeModule;
const { store } = storeModule;
const { nowMillis } = runtimeModule;
const { MAX_REJECTIONS } = threadRun.threadRuns;
const { scheduling } = schedule;

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

function finish(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  record: PullRequest,
  merged: string,
): Effect.Effect<MergeOutcome> {
  return Effect.gen(function* () {
    const removed = yield* worktrees.cleanUp(runtime, task, record.branch);
    const cleaned = removed.length === 0 ? "" : ` Removed ${removed.join(", ")}.`;
    return { kind: "merged", line: `${merged}${cleaned}` };
  });
}

interface Ready {
  owner: { branch: string; base: string; cwd: string };
  record: PullRequest;
  verified: Verified;
}

function squash(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  ready: Ready,
): Effect.Effect<MergeOutcome> {
  return Effect.gen(function* () {
    const { owner, record, verified } = ready;
    const [merging, after] = yield* Effect.uninterruptible(
      Effect.all([
        Effect.result(pullRequests.merge(runtime, owner.cwd, record.number, verified)),
        Effect.result(pullRequests.view(runtime, owner.cwd, record.number)),
      ]),
    );
    if (Result.isSuccess(after)) {
      const now = yield* nowMillis;
      const saved = pullRequests.save(runtime, task.id, after.success, verified, now);
      if (saved.state === "MERGED") {
        return yield* finish(
          runtime,
          task,
          saved,
          `Squash-merged PR #${saved.number} at head ${short(verified.sha)}.`,
        );
      }
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
    const why = Result.isFailure(merging)
      ? merging.failure.message
      : Result.isFailure(after)
        ? after.failure.message
        : `#${record.number} is still ${after.success.state.toLowerCase()}`;
    return {
      kind: "stopped",
      line: `The review passed, but the harness could not merge PR #${record.number}, so the task is stopped, not completed: ${why}`,
    };
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

function blockedInARow(runtime: runtimeTypes.Runtime, taskId: string): number {
  const verdicts = store
    .reportsOfTask(runtime.database, taskId)
    .flatMap((report) =>
      report.role === "reviewer" && report.verdict !== null ? [report.verdict] : [],
    );
  return verdicts.length - 1 - verdicts.findLastIndex((verdict) => verdict !== "pass");
}

function blocked(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  record: PullRequest,
  problems: readonly string[],
): MergeOutcome {
  if (blockedInARow(runtime, task.id) < MAX_REJECTIONS) return sendBack(problems, record.number);
  return {
    kind: "stopped",
    line: `The review passed, but the harness could not merge PR #${record.number} (${record.branch}) after ${MAX_REJECTIONS + 1} passing reviews in a row, so the task is stopped, not completed: ${problems.join(" ")} Merge it by hand once it is current, or rerun the task.`,
  };
}

interface Read {
  owner: Ready["owner"];
  record: PullRequest;
  pull: Parameters<typeof pullRequests.verifiedOf>[0];
  verified: Verified | null;
}

function read(
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
      const got = yield* read(runtime, task, owner);
      if ("kind" in got) return got;
      const { pull, record, verified } = got;
      if (record.state === "MERGED") {
        return yield* finish(runtime, task, record, `PR #${record.number} was already merged.`);
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
      if (now - since >= waitMs) {
        return {
          kind: "stopped",
          line: `The review passed, but CI on PR #${record.number} (${record.branch}) did not finish within ${Math.round(waitMs / 60_000)} minutes, so the task is stopped, not completed: ${problems.map((problem) => problem.text).join(" ")}`,
        };
      }
      yield* Effect.sleep(pollMs);
    }
  });
}

interface Ended {
  status: "completed" | "stopped";
  line: string;
}

function settleInterrupted(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
): Effect.Effect<Ended | undefined> {
  return Effect.gen(function* () {
    const recorded = store.pullRequestOf(runtime.database, task.id);
    const owner = yield* pullRequests.ownerOf(runtime, task);
    const status = store.getTask(runtime.database, task.id)?.status;
    if (recorded === undefined || owner === undefined) return undefined;
    if (status !== "running" && status !== "stopped") return undefined;
    const found = yield* Effect.result(pullRequests.current(runtime, owner));
    const pull = Result.isSuccess(found) ? found.success : undefined;
    const now = yield* nowMillis;
    if (pull?.number === recorded.number && pull.state.toUpperCase() === "MERGED") {
      const record = pullRequests.save(runtime, task.id, pull, recorded.verified, now);
      const done = yield* finish(
        runtime,
        task,
        record,
        `PR #${record.number} was merged while the run was ending, so ${task.id} is completed, not ${status}.`,
      );
      store.setTaskStatus(runtime.database, task.id, "completed", now);
      return { line: done.line, status: "completed" };
    }
    if (status !== "running") return undefined;
    store.setTaskStatus(runtime.database, task.id, "stopped", now);
    const why = Result.isFailure(found)
      ? found.failure.message
      : `#${recorded.number} is ${pull?.state.toLowerCase() ?? "gone"}`;
    return {
      line: `The run of ${task.id} ended while the harness was merging PR #${recorded.number}, so the task is stopped, not completed: ${why}`,
      status: "stopped",
    };
  });
}

function afterInterrupt(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
): Effect.Effect<void, runtimeTypes.OrchestratorError> {
  return Effect.gen(function* () {
    const ended = yield* settleInterrupted(runtime, task);
    if (ended === undefined) return;
    const started = yield* scheduling.scheduleEffect(runtime);
    runtime.publish();
    runtime.options.report(`${task.title} (${task.id}) ${ended.status}.\n\n${ended.line}`, {
      role: "reviewer",
      started,
      status: ended.status,
      taskId: task.id,
    });
  });
}

const pullRequestMerge = { afterInterrupt, afterReview };

const pullRequestMergeModule = { pullRequestMerge };

export default pullRequestMergeModule;
