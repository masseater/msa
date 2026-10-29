import { Effect } from "effect";

import ids from "./ids.ts";
import pullRequestRefresh from "./pull-request-refresh.ts";
import type replanApplyInternalTypes from "./replan-apply-internal.types.ts";
import type replanTypes from "./replan.types.ts";
import repoState from "./repo-state.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { newId } = ids;
const { repoStates } = repoState;
const { store } = storeModule;

function collect(
  runtime: runtimeTypes.Runtime,
  memos: ReadonlyMap<string, string>,
): Effect.Effect<replanApplyInternalTypes.Handoff[]> {
  return Effect.gen(function* () {
    const database = runtime.database;
    const handoffs: replanApplyInternalTypes.Handoff[] = [];
    for (const [threadId, memo] of memos) {
      const thread = store.getThread(database, threadId);
      for (const assignment of store.assignmentsOfThread(database, threadId)) {
        const task = store.getTask(database, assignment.taskId);
        if (task === undefined) continue;
        const repo = yield* repoStates.read(thread?.cwd ?? task.cwd);
        handoffs.push({ memo, repo, taskId: task.id, threadId, title: task.title });
      }
    }
    return handoffs;
  });
}

function readPullRequests(
  runtime: runtimeTypes.Runtime,
  taskIds: readonly string[],
): Effect.Effect<orchestratorTypesTypes.UnreadPullRequest[]> {
  return Effect.map(
    Effect.forEach(taskIds, (taskId) => pullRequestRefresh.refreshOrUnread(runtime, taskId)),
    (reads) => reads.flatMap((unread) => unread ?? []),
  );
}

function memoBlock(
  replanId: string,
  reason: string,
  handoff: replanApplyInternalTypes.Handoff,
): string {
  return [
    `replan ${replanId}: ${reason}`,
    repoStates.describe(handoff.repo),
    "",
    handoff.memo,
  ].join("\n");
}

function writeReport(
  runtime: runtimeTypes.Runtime,
  taskId: string,
  threadId: string,
  content: string,
  now: number,
): void {
  store.insertReport(runtime.database, {
    content,
    createdAt: now,
    id: newId("rep"),
    role: "worker",
    status: "stopped",
    taskId,
    threadId,
    verdict: null,
  });
}

function writeHandoffs(
  runtime: runtimeTypes.Runtime,
  prepared: replanTypes.Prepared,
  handoffs: readonly replanApplyInternalTypes.Handoff[],
  replanId: string,
  now: number,
  inheritors: ReadonlyMap<string, readonly string[]>,
): void {
  for (const handoff of handoffs) {
    const content = memoBlock(replanId, prepared.input.reason, handoff);
    writeReport(runtime, handoff.taskId, handoff.threadId, content, now);
    const targets = prepared.keep.includes(handoff.taskId)
      ? [handoff.taskId]
      : [...(inheritors.get(handoff.taskId) ?? [])];
    if (targets.length === 0) continue;
    for (const target of targets) writeReport(runtime, target, handoff.threadId, content, now);
    store.insertNote(runtime.database, {
      author: "replan",
      content,
      createdAt: now,
      id: newId("note"),
      project: runtime.options.project,
      round: null,
      taskIds: targets,
    });
  }
}

const replanHandoffs = { collect, readPullRequests, writeHandoffs, writeReport };

export default replanHandoffs;
