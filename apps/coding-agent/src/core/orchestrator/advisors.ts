import { Effect } from "effect";

import advisorWorkspace from "./advisor-workspace.ts";
import idsModule from "./ids.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";

const { abortThread } = runtimeModule;
const { store } = storeModule;
const { newId } = idsModule;

const STOPPED =
  "Stopped: the orchestrator answered the decision before this advisor finished, so its advice would be stale. Its checkout was removed.";

function dropProviderWait(runtime: runtimeTypes.Runtime, taskId: string): void {
  const waiting = store
    .listProviderWaits(runtime.database, runtime.options.project)
    .some((wait) => wait.taskId === taskId && wait.role === "advisor");
  if (waiting) store.deleteProviderWait(runtime.database, taskId);
}

function stopRunning(
  runtime: runtimeTypes.Runtime,
  taskId: string,
  now: number,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const database = runtime.database;
    yield* Effect.sync(() => dropProviderWait(runtime, taskId));
    for (const assignment of store.assignmentsOfTask(database, taskId)) {
      if (assignment.role !== "advisor") continue;
      const thread = store.getThread(database, assignment.threadId);
      if (thread?.status !== "running") continue;
      abortThread(runtime, thread.id);
      yield* Effect.sync(() => {
        store.updateThread(database, thread.id, { status: "stopped" }, now);
        store.insertReport(database, {
          content: STOPPED,
          createdAt: now,
          id: newId(`rep-${thread.id}-advisor`),
          role: "advisor",
          status: "stopped",
          taskId,
          threadId: thread.id,
          verdict: null,
        });
      });
      yield* advisorWorkspace.remove(thread.cwd);
    }
  });
}

const advisors = { stopRunning };

export default advisors;
