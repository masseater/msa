import ids from "./ids.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { store } = storeModule;
const { newId } = ids;

function ensureReview(
  runtime: runtimeTypes.Runtime,
  round: string,
  now: number,
): orchestratorTypesTypes.Task {
  const database = runtime.database;
  const project = runtime.options.project;
  store.insertRound(database, project, round, round, now);
  const existing = store.reviewTaskOfRound(database, project, round);
  if (existing !== undefined) return existing;
  const review: orchestratorTypesTypes.Task = {
    checks: [],
    condition: null,
    createdAt: now,
    currentState: `Every task of round ${round} has finished.`,
    cwd: runtime.options.cwd,
    goalState: `Round ${round} is reviewed as a whole and the remaining work is laid out.`,
    id: newId("rev"),
    kind: "review",
    mergeInto: null,
    model: null,
    opensPullRequest: false,
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

function attachReview(
  runtime: runtimeTypes.Runtime,
  review: orchestratorTypesTypes.Task,
  taskId: string,
  now: number,
): void {
  const database = runtime.database;
  store.addDependency(database, runtime.options.project, review.id, taskId);
  if (review.status !== "waiting" && review.status !== "running") {
    store.setTaskStatus(database, review.id, "waiting", now);
  }
}

const rounds = { attachReview, ensureReview };

const roundsModule = {
  rounds,
};

export default roundsModule;
