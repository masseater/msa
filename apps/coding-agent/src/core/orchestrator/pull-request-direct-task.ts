import { Effect } from "effect";

import pullRequestDirectSupport from "./pull-request-direct-support.ts";
import pullRequestFinish from "./pull-request-finish.ts";
import pullRequestMergeModule from "./pull-request-merge.ts";
import pullRequestsModule from "./pull-requests.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import schedule from "./schedule.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { blockers, failWith, readView, refuse, whyNot } = pullRequestDirectSupport;
const { pullRequestMerge } = pullRequestMergeModule;
const { pullRequests } = pullRequestsModule;
const { scheduling } = schedule;
const { store } = storeModule;
const { nowMillis } = runtimeModule;

type Task = orchestratorTypesTypes.Task;
type PullRequest = orchestratorTypesTypes.PullRequest;
type OrchestratorError = runtimeTypes.OrchestratorError;

const SETTLED: ReadonlySet<orchestratorTypesTypes.TaskStatus> = new Set([
  "completed",
  "failed",
  "stopped",
]);

function linkedTask(
  runtime: runtimeTypes.Runtime,
  number: number,
): { task: Task; record: PullRequest } | undefined {
  const record = store
    .listPullRequests(runtime.database, runtime.options.project)
    .filter((candidate) => candidate.number === number)
    .toSorted((left, right) => right.checkedAt - left.checkedAt)[0];
  const task = record === undefined ? undefined : store.getTask(runtime.database, record.taskId);
  return task === undefined || record === undefined ? undefined : { record, task };
}

function complete(
  runtime: runtimeTypes.Runtime,
  task: Task,
  line: string,
): Effect.Effect<string, OrchestratorError> {
  return Effect.gen(function* () {
    const now = yield* nowMillis;
    if (SETTLED.has(store.getTask(runtime.database, task.id)?.status ?? "running")) {
      store.setTaskStatus(runtime.database, task.id, "completed", now);
    }
    yield* scheduling.scheduleEffect(runtime);
    runtime.publish();
    return `${line} Task ${task.id} is completed.`;
  });
}

function settleOrLand(
  runtime: runtimeTypes.Runtime,
  task: Task,
  ready: Parameters<typeof pullRequestMergeModule.pullRequestMerge.land>[2],
) {
  const { owner, record } = ready;
  if (record.state !== "MERGED") return pullRequestMerge.land(runtime, task, ready);
  return Effect.map(
    pullRequestFinish.settleMerged(
      runtime,
      task,
      owner.cwd,
      record,
      `PR #${record.number} was already merged.`,
    ),
    (settled) => ({ read: record, settled, tried: undefined }),
  );
}

function mergeTaskPull(
  runtime: runtimeTypes.Runtime,
  task: Task,
  recorded: PullRequest,
  head: string,
): Effect.Effect<string, OrchestratorError> {
  return Effect.gen(function* () {
    const { number } = recorded;
    if (!SETTLED.has(task.status)) {
      return yield* refuse(
        number,
        `it is the pull request of task ${task.id} "${task.title}", which is ${task.status}, and the harness merges it after that task's review passes. Stop the task with stop_task first to merge it yourself.`,
      );
    }
    const owner = (yield* pullRequests.ownerOf(runtime, task)) ?? {
      base: recorded.base,
      branch: recorded.branch,
      cwd: runtime.options.cwd,
    };
    const pull = yield* readView(runtime, owner.cwd, number);
    const now = yield* nowMillis;
    const record = pullRequests.save(runtime, task.id, pull, recorded.verified, now);
    const reviewed = recorded.verified?.sha === head ? recorded.verified : null;
    const verified = reviewed ?? { ...pullRequests.verifiedOf(pull), sha: head };
    const blocked = record.state === "MERGED" ? [] : blockers(runtime, record, pull, verified, now);
    if (blocked.length > 0) return yield* refuse(number, blocked.join(" "));
    const { read, settled, tried } = yield* settleOrLand(runtime, task, {
      owner,
      record,
      verified,
    });
    if (settled?.kind === "merged") return yield* complete(runtime, task, settled.line);
    if (settled !== undefined) return yield* failWith(settled.line);
    return yield* refuse(number, whyNot(tried, read?.state));
  });
}

const pullRequestDirectTask = { linkedTask, mergeTaskPull };

export default pullRequestDirectTask;
