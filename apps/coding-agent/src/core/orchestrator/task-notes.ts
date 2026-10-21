import { Effect } from "effect";

import actionHelpersModule from "./action-helpers.ts";
import errors from "./errors.ts";
import idsModule from "./ids.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import snapshotModule from "./snapshot.ts";
import startModule from "./start.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { nowMillis } = runtimeModule;
const { store } = storeModule;
const { orchestratorError } = errors;
const { newId } = idsModule;
const { snapshots } = snapshotModule;
const { starting } = startModule;
const { actionHelpers } = actionHelpersModule;

function sendNote(runtime: runtimeTypes.Runtime, input: orchestratorTypesTypes.SendNoteInput) {
  return Effect.gen(function* () {
    const now = yield* nowMillis;
    const database = runtime.database;
    const project = runtime.options.project;
    const round = input.audience === "round" ? (input.round ?? null) : null;
    const taskIds = input.audience === "tasks" ? [...new Set(input.taskIds ?? [])] : [];
    if (input.audience === "round" && round === null) throw new Error("audience round needs round");
    if (input.audience === "tasks" && taskIds.length === 0) {
      throw new Error("audience tasks needs taskIds");
    }
    const note: orchestratorTypesTypes.Note = {
      author: "orchestrator",
      content: input.content,
      createdAt: now,
      id: newId("note"),
      project,
      round,
      taskIds,
    };
    yield* Effect.sync(() => store.insertNote(database, note));
    const steered: string[] = [];
    for (const thread of store.runningThreads(database, project)) {
      const tasks = store
        .assignmentsOfThread(database, thread.id)
        .flatMap((assignment) => store.getTask(database, assignment.taskId) ?? []);
      if (!tasks.some((task) => actionHelpers.appliesTo(note, task))) continue;
      const worker = runtime.workers.get(thread.id);
      if (worker === undefined) continue;
      yield* Effect.tryPromise({
        catch: orchestratorError,
        try: () => worker.run.queue.steer(input.content),
      });
      yield* Effect.sync(() => store.markNoteRead(database, note.id, thread.id, now));
      steered.push(thread.id);
    }
    const waiting = snapshots
      .taskViews(database, project)
      .filter((task) => task.status === "waiting" && actionHelpers.appliesTo(note, task));
    yield* Effect.sync(() => runtime.publish());
    return {
      noteId: note.id,
      steeredThreads: steered,
      waitingTasks: waiting.map((task) => task.id),
    };
  });
}

function sendMessage(runtime: runtimeTypes.Runtime, taskId: string, message: string) {
  return Effect.gen(function* () {
    const task = store.getTask(runtime.database, taskId);
    if (task === undefined) throw new Error(`Unknown task: ${taskId}`);
    if (task.status === "completed" || task.status === "failed" || task.status === "stopped") {
      yield* starting.startTasks(runtime, task, "worker", "", message);
      yield* Effect.sync(() => runtime.publish());
      return actionHelpers.taskView(runtime, taskId);
    }
    yield* sendNote(runtime, { audience: "tasks", content: message, taskIds: [taskId] });
    return actionHelpers.taskView(runtime, taskId);
  });
}

const taskNotes = { sendMessage, sendNote };

export default taskNotes;
