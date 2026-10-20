import { newId } from "./ids.ts";
import type { Runtime } from "./runtime.ts";
import { store } from "./store.ts";
import type { Task } from "./types.ts";

function ensureReview(runtime: Runtime, round: string, now: number): Task {
  const database = runtime.database;
  const project = runtime.options.project;
  const existing = store.reviewTaskOfRound(database, project, round);
  if (existing !== undefined) return existing;
  const review: Task = {
    condition: null,
    createdAt: now,
    currentState: `Every task of round ${round} has finished.`,
    cwd: runtime.options.cwd,
    goalState: `Round ${round} is reviewed as a whole and the remaining work is laid out.`,
    id: newId("rev"),
    kind: "review",
    model: null,
    project,
    round,
    status: "waiting",
    thinkingLevel: null,
    title: `Review of ${round}`,
    updatedAt: now,
  };
  store.insertTask(database, review);
  return review;
}

function attachReview(runtime: Runtime, review: Task, taskId: string, now: number): void {
  const database = runtime.database;
  store.addDependency(database, runtime.options.project, review.id, taskId);
  if (review.status !== "waiting" && review.status !== "running") {
    store.setTaskStatus(database, review.id, "waiting", now);
  }
}

export const rounds = { attachReview, ensureReview };
