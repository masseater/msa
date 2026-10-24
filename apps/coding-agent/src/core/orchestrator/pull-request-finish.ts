import { Effect, Result } from "effect";

import pullRequestsModule from "./pull-requests.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import schedule from "./schedule.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";
import worktreeModule from "./worktree.ts";

const { pullRequests } = pullRequestsModule;
const { worktrees } = worktreeModule;
const { store } = storeModule;
const { nowMillis } = runtimeModule;
const { scheduling } = schedule;

type MergeOutcome = runtimeTypes.MergeOutcome;
type PullRequest = orchestratorTypesTypes.PullRequest;

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

interface Ended {
  status: "completed" | "stopped";
  line: string;
}

function readBack(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  recorded: PullRequest,
): Effect.Effect<{ record: PullRequest } | { why: string }> {
  return Effect.gen(function* () {
    if (recorded.state === "MERGED") return { record: recorded };
    const owner = yield* pullRequests.ownerOf(runtime, task);
    if (owner === undefined) return { why: `the worktree of ${task.id} is gone` };
    const found = yield* Effect.result(pullRequests.current(runtime, owner));
    if (Result.isFailure(found)) return { why: found.failure.message };
    const pull = found.success;
    if (pull?.number !== recorded.number || pull.state.toUpperCase() !== "MERGED") {
      return { why: `#${recorded.number} is ${pull?.state.toLowerCase() ?? "gone"}` };
    }
    const now = yield* nowMillis;
    return { record: pullRequests.save(runtime, task.id, pull, recorded.verified, now) };
  });
}

function settleInterrupted(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
): Effect.Effect<Ended | undefined> {
  return Effect.gen(function* () {
    const recorded = store.pullRequestOf(runtime.database, task.id);
    const status = store.getTask(runtime.database, task.id)?.status;
    if (recorded === undefined) return undefined;
    if (status !== "running" && status !== "stopped") return undefined;
    const read = yield* readBack(runtime, task, recorded);
    const now = yield* nowMillis;
    if ("record" in read) {
      const { record } = read;
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
    return {
      line: `The run of ${task.id} ended while the harness was merging PR #${recorded.number}, so the task is stopped, not completed: ${read.why}`,
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

const pullRequestFinish = { afterInterrupt, finish };

export default pullRequestFinish;
