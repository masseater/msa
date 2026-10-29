import { Effect } from "effect";

import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { abortThread } = runtimeModule;
const { store } = storeModule;

interface Held {
  taskId: string;
  threadId: string;
  waitsFor: string[];
}

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

function holdOne(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  now: number,
): Held | undefined {
  const database = runtime.database;
  const waitsFor = store.unfinishedDependencies(database, task.id);
  if (waitsFor.length === 0) return undefined;
  const review = runningReview(runtime, task);
  if (review === undefined) return undefined;
  abortThread(runtime, review.threadId);
  store.updateThread(database, review.threadId, { status: "stopped" }, now);
  store.insertReport(database, {
    content: `Stopped: ${task.id} now depends on ${waitsFor.join(", ")}, which ${waitsFor.length === 1 ? "has" : "have"} not finished, so this review would judge unfinished work. ${task.kind === "review" ? "The review" : "The task"} waits and starts again once ${waitsFor.length === 1 ? "it completes" : "they complete"}.`,
    createdAt: now,
    id: `rep-${review.threadId}-${task.id}-held`,
    role: "reviewer",
    status: "stopped",
    taskId: task.id,
    threadId: review.threadId,
    verdict: null,
  });
  store.setTaskStatus(database, task.id, "waiting", now);
  return { taskId: task.id, threadId: review.threadId, waitsFor };
}

function holdReviews(runtime: runtimeTypes.Runtime, now: number): Effect.Effect<string[]> {
  return Effect.sync(() => {
    const held = store
      .listTasks(runtime.database, runtime.options.project)
      .filter((task) => task.status === "running")
      .flatMap((task) => holdOne(runtime, task, now) ?? []);
    for (const item of held) {
      const task = store.getTask(runtime.database, item.taskId);
      runtime.options.report(
        `${task?.title ?? item.taskId} (${item.taskId}) waiting.\n\nIts review in ${item.threadId} was stopped: it now depends on ${item.waitsFor.join(", ")}, which ${item.waitsFor.length === 1 ? "has" : "have"} not finished. It starts again once ${item.waitsFor.length === 1 ? "it completes" : "they complete"}.`,
        { role: "reviewer", started: [], status: "waiting", taskId: item.taskId },
      );
    }
    return held.map((item) => item.taskId);
  });
}

const reviewHold = { holdReviews };

export default reviewHold;
