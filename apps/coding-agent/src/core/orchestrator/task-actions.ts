import { Effect } from "effect";

import { actionHelpers } from "./action-helpers.ts";
import { type OrchestratorError, orchestratorError } from "./errors.ts";
import { newId } from "./ids.ts";
import { type Runtime, nowMillis } from "./runtime.ts";
import { scheduling } from "./schedule.ts";
import { snapshots } from "./snapshot.ts";
import { starting } from "./start.ts";
import { store } from "./store.ts";
import type { Note, NoteDelivery, SendNoteInput, TaskView } from "./types.ts";

function sendNote(
  runtime: Runtime,
  input: SendNoteInput,
): Effect.Effect<NoteDelivery, OrchestratorError> {
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
    const note: Note = {
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
        try: () => worker.steer(input.content),
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

function sendMessage(
  runtime: Runtime,
  taskId: string,
  message: string,
): Effect.Effect<TaskView, OrchestratorError> {
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

function stop(runtime: Runtime, taskId: string): Effect.Effect<TaskView, OrchestratorError> {
  return Effect.gen(function* () {
    const now = yield* nowMillis;
    const database = runtime.database;
    const task = store.getTask(database, taskId);
    if (task === undefined) throw new Error(`Unknown task: ${taskId}`);
    const thread = actionHelpers.runningThreadOf(runtime, taskId);
    if (thread !== undefined) {
      runtime.runs.delete(thread.id);
      void runtime.workers
        .get(thread.id)
        ?.abort()
        .catch(() => undefined);
      yield* Effect.sync(() => store.updateThread(database, thread.id, { status: "stopped" }, now));
    }
    yield* Effect.sync(() => {
      store.setTaskStatus(database, taskId, "stopped", now);
      const review = store.reviewTaskOfRound(database, runtime.options.project, task.round);
      if (review !== undefined) store.removeDependency(database, review.id, taskId);
    });
    yield* scheduling.scheduleEffect(runtime);
    yield* Effect.sync(() => runtime.publish());
    return actionHelpers.taskView(runtime, taskId);
  });
}

function rerun(
  runtime: Runtime,
  taskId: string,
  extra = "",
): Effect.Effect<TaskView, OrchestratorError> {
  return Effect.gen(function* () {
    const task = store.getTask(runtime.database, taskId);
    if (task === undefined) throw new Error(`Unknown task: ${taskId}`);
    if (task.status === "running") throw new Error(`${taskId} is already running`);
    yield* starting.startTasks(runtime, task, "worker", "", extra);
    yield* Effect.sync(() => runtime.publish());
    return actionHelpers.taskView(runtime, taskId);
  });
}

function setMaxConcurrent(
  runtime: Runtime,
  value: number,
): Effect.Effect<number, OrchestratorError> {
  return Effect.gen(function* () {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error("max concurrent threads must be an integer of at least 1");
    }
    yield* Effect.sync(() =>
      store.storeMaxConcurrent(runtime.database, runtime.options.project, value),
    );
    runtime.maxConcurrentThreads = value;
    yield* scheduling.scheduleEffect(runtime);
    yield* Effect.sync(() => runtime.publish());
    return value;
  });
}

export const taskActions = { rerun, sendMessage, sendNote, setMaxConcurrent, stop };
