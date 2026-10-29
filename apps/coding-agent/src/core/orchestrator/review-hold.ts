import { Effect } from "effect";

import ids from "./ids.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { newId } = ids;
const { abortThread } = runtimeModule;
const { store } = storeModule;

interface Held {
  taskId: string;
  threadId: string;
  waitsFor: string[];
}

const waits = (waitsFor: readonly string[]) =>
  `${waitsFor.join(", ")}, which ${waitsFor.length === 1 ? "has" : "have"} not finished`;

const startsAgain = (waitsFor: readonly string[]) =>
  `starts again once ${waitsFor.length === 1 ? "it completes" : "they complete"}`;

function runningReview(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
): orchestratorTypesTypes.Assignment | undefined {
  return store
    .assignmentsOfTask(runtime.database, task.id)
    .find(
      (assignment) =>
        assignment.role === "reviewer" &&
        store.getThread(runtime.database, assignment.threadId)?.status === "running",
    );
}

function hold(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  threadId: string,
  waitsFor: string[],
  now: number,
): Held {
  const database = runtime.database;
  abortThread(runtime, threadId);
  store.updateThread(database, threadId, { status: "stopped" }, now);
  store.insertReport(database, {
    content: `Stopped: ${task.id} now depends on ${waits(waitsFor)}, so this review would judge unfinished work. ${task.kind === "review" ? "The review" : "The task"} waits and ${startsAgain(waitsFor)}.`,
    createdAt: now,
    id: `rep-${threadId}-${task.id}-held`,
    role: "reviewer",
    status: "stopped",
    taskId: task.id,
    threadId,
    verdict: null,
  });
  store.setTaskStatus(database, task.id, "waiting", now);
  return { taskId: task.id, threadId, waitsFor };
}

function announce(runtime: runtimeTypes.Runtime, held: readonly Held[]): void {
  if (held.length === 0) return;
  for (const item of held) {
    const task = store.getTask(runtime.database, item.taskId);
    runtime.options.report(
      `${task?.title ?? item.taskId} (${item.taskId}) waiting.\n\nIts review in ${item.threadId} was stopped: it now depends on ${waits(item.waitsFor)}. It ${startsAgain(item.waitsFor)}.`,
      { role: "reviewer", started: [], status: "waiting", taskId: item.taskId },
    );
  }
  runtime.publish();
}

function holdReviews(runtime: runtimeTypes.Runtime, now: number): Effect.Effect<string[]> {
  return Effect.sync(() => {
    const held = store
      .listTasks(runtime.database, runtime.options.project)
      .filter((task) => task.status === "running")
      .flatMap((task) => {
        const waitsFor = store.unfinishedDependencies(runtime.database, task.id);
        const review = waitsFor.length === 0 ? undefined : runningReview(runtime, task);
        return review === undefined ? [] : [hold(runtime, task, review.threadId, waitsFor, now)];
      });
    announce(runtime, held);
    return held.map((item) => item.taskId);
  });
}

function holdReview(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  threadId: string,
  now: number,
  decision = "",
): Effect.Effect<boolean> {
  return Effect.sync(() => {
    const waitsFor = store.unfinishedDependencies(runtime.database, task.id);
    if (waitsFor.length === 0) return false;
    if (decision !== "")
      store.insertNote(runtime.database, {
        author: "orchestrator",
        content: decision,
        createdAt: now,
        id: newId("note"),
        project: runtime.options.project,
        round: null,
        taskIds: [task.id],
      });
    announce(runtime, [hold(runtime, task, threadId, waitsFor, now)]);
    return true;
  });
}

function blockedByDependencies(runtime: runtimeTypes.Runtime, taskId: string): boolean {
  return store.unfinishedDependencies(runtime.database, taskId).length > 0;
}

const reviewHold = { blockedByDependencies, holdReview, holdReviews };

export default reviewHold;
