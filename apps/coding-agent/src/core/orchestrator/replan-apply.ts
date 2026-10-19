import { Effect } from "effect";

import type { OrchestratorError } from "./errors.ts";
import { newId } from "./ids.ts";
import { replanStore } from "./replan-store.ts";
import { fail, unique } from "./replan-support.ts";
import type { Prepared, PreparedUndo } from "./replan.ts";
import { type RepoState, repoStates } from "./repo-state.ts";
import { rounds } from "./rounds.ts";
import { type Runtime, nowMillis } from "./runtime.ts";
import { scheduling } from "./schedule.ts";
import { store } from "./store.ts";
import type {
  ReplanChanges,
  ReplanCreated,
  ReplanDropped,
  ReplanResult,
  ReplanRewired,
  ReplanStopped,
  ReplanTaskInput,
  ReplanUndoResult,
  Task,
} from "./types.ts";

interface Handoff {
  taskId: string;
  sessionId: string;
  title: string;
  memo: string;
  repo: RepoState;
}

interface Creation {
  created: ReplanCreated[];
  ids: string[];
  inheritors: Map<string, string[]>;
  byKey: Map<string, string>;
}

function collect(runtime: Runtime, memos: ReadonlyMap<string, string>): Effect.Effect<Handoff[]> {
  return Effect.gen(function* () {
    const database = runtime.database;
    const handoffs: Handoff[] = [];
    for (const [sessionId, memo] of memos) {
      for (const assignment of store.assignmentsOfSession(database, sessionId)) {
        const task = store.getTask(database, assignment.taskId);
        if (task === undefined) continue;
        const repo = yield* repoStates.read(task.cwd);
        handoffs.push({ taskId: task.id, sessionId, title: task.title, memo, repo });
      }
    }
    return handoffs;
  });
}

function memoBlock(replanId: string, reason: string, handoff: Handoff): string {
  return [
    `replan ${replanId}: ${reason}`,
    repoStates.describe(handoff.repo),
    "",
    handoff.memo,
  ].join("\n");
}

function writeReport(
  runtime: Runtime,
  taskId: string,
  sessionId: string,
  content: string,
  now: number,
): void {
  store.insertReport(runtime.database, {
    id: newId("rep"),
    taskId,
    sessionId,
    role: "worker",
    status: "stopped",
    content,
    createdAt: now,
  });
}

function detachReview(runtime: Runtime, task: Task): void {
  const review = store.reviewTaskOfRound(runtime.database, runtime.options.project, task.round);
  if (review !== undefined) store.removeDependency(runtime.database, review.id, task.id);
}

function closeDropped(
  runtime: Runtime,
  prepared: Prepared,
  replanId: string,
  now: number,
): ReplanDropped[] {
  const database = runtime.database;
  const dropped: ReplanDropped[] = [];
  for (const item of prepared.drop) {
    const task = store.getTask(database, item.taskId);
    if (task === undefined) continue;
    detachReview(runtime, task);
    store.setTaskStatus(database, task.id, "stopped", now);
    writeReport(runtime, task.id, "replan", `dropped by replan ${replanId}: ${item.reason}`, now);
    dropped.push({ taskId: task.id, title: task.title, reason: item.reason });
  }
  for (const entry of prepared.entries) {
    for (const id of entry.from) {
      const task = store.getTask(database, id);
      if (task === undefined) continue;
      detachReview(runtime, task);
      store.setTaskStatus(database, id, "stopped", now);
    }
  }
  return dropped;
}

function inheritorCount(prepared: Prepared): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of prepared.entries) {
    for (const id of entry.from) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function roundFor(input: ReplanTaskInput, sources: readonly Task[]): string {
  if (input.round !== undefined) return input.round;
  if (sources.length === 1) return sources[0]!.round;
  return "main";
}

function newTask(
  runtime: Runtime,
  input: ReplanTaskInput,
  sources: readonly Task[],
  single: boolean,
  now: number,
): Task {
  return {
    id: newId("t"),
    project: runtime.options.project,
    round: roundFor(input, sources),
    kind: "work",
    title: input.title,
    prompt: input.prompt ?? sources.map((source) => source.prompt).join("\n\n"),
    status: "waiting",
    priority: input.priority ?? Math.max(0, ...sources.map((source) => source.priority)),
    cwd: input.cwd ?? sources[0]?.cwd ?? runtime.options.cwd,
    paths: input.paths ?? (single ? (sources[0]?.paths ?? []) : []),
    repos: input.repos ?? (single ? (sources[0]?.repos ?? []) : []),
    condition: null,
    model: input.model ?? null,
    thinkingLevel: input.thinkingLevel ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

function createTasks(
  runtime: Runtime,
  prepared: Prepared,
  counts: ReadonlyMap<string, number>,
  now: number,
): Creation {
  const database = runtime.database;
  const project = runtime.options.project;
  const closed = new Set(prepared.sources);
  const created: ReplanCreated[] = [];
  const ids: string[] = [];
  const inheritors = new Map<string, string[]>();
  const byKey = new Map<string, string>();
  const pending: { taskId: string; refs: readonly string[]; explicit: boolean }[] = [];
  for (const entry of prepared.entries) {
    const sources = entry.from.flatMap((id) => prepared.views.get(id) ?? []);
    const existingReview = store.reviewTaskOfRound(
      database,
      project,
      roundFor(entry.input, sources),
    );
    const task = newTask(
      runtime,
      entry.input,
      sources,
      entry.from.length === 1 && counts.get(entry.from[0]!) === 1,
      now,
    );
    store.insertTask(database, task);
    const review = rounds.ensureReview(runtime, task.round, now);
    if (existingReview === undefined) ids.push(review.id);
    rounds.attachReview(runtime, review, task.id, now);
    if (entry.key !== null) byKey.set(entry.key, task.id);
    created.push({ taskId: task.id, title: task.title, from: entry.from });
    ids.push(task.id);
    for (const source of entry.from) {
      inheritors.set(source, [...(inheritors.get(source) ?? []), task.id]);
    }
    pending.push({
      taskId: task.id,
      refs: entry.input.dependsOn ?? sources.flatMap((source) => source.dependsOn),
      explicit: entry.input.dependsOn !== undefined,
    });
  }
  for (const item of pending) {
    for (const ref of unique(item.refs)) {
      const id = byKey.get(ref) ?? ref;
      if (!item.explicit && closed.has(id)) continue;
      if (item.explicit && closed.has(id)) {
        throw fail(`${item.taskId} cannot depend on ${id}, which this replan closes`);
      }
      store.addDependency(database, project, item.taskId, id);
    }
  }
  return { created, ids, inheritors, byKey };
}

function rewire(
  runtime: Runtime,
  prepared: Prepared,
  byKey: ReadonlyMap<string, string>,
): ReplanRewired[] {
  const database = runtime.database;
  const rewired: ReplanRewired[] = [];
  for (const item of prepared.rewire) {
    const refs = unique(item.dependsOn.map((ref) => byKey.get(ref) ?? ref));
    store.clearDependencies(database, item.taskId);
    for (const dependency of refs) {
      store.addDependency(database, runtime.options.project, item.taskId, dependency);
    }
    rewired.push({ taskId: item.taskId, dependsOn: refs });
  }
  return rewired;
}

function keep(runtime: Runtime, prepared: Prepared, now: number): void {
  const database = runtime.database;
  for (const id of prepared.keep) {
    const task = store.getTask(database, id);
    if (task?.status === "stopped") store.setTaskStatus(database, id, "waiting", now);
  }
}

function writeHandoffs(
  runtime: Runtime,
  prepared: Prepared,
  handoffs: readonly Handoff[],
  replanId: string,
  now: number,
  inheritors: ReadonlyMap<string, readonly string[]>,
): string[] {
  const noteIds: string[] = [];
  for (const handoff of handoffs) {
    const content = memoBlock(replanId, prepared.input.reason, handoff);
    writeReport(runtime, handoff.taskId, handoff.sessionId, content, now);
    const targets = prepared.keep.includes(handoff.taskId)
      ? [handoff.taskId]
      : [...(inheritors.get(handoff.taskId) ?? [])];
    if (targets.length === 0) continue;
    for (const target of targets) writeReport(runtime, target, handoff.sessionId, content, now);
    const noteId = newId("note");
    store.insertNote(runtime.database, {
      id: noteId,
      project: runtime.options.project,
      round: null,
      taskIds: targets,
      content,
      author: "replan",
      createdAt: now,
    });
    noteIds.push(noteId);
  }
  return noteIds;
}

function write(
  runtime: Runtime,
  prepared: Prepared,
  handoffs: readonly Handoff[],
  replanId: string,
  now: number,
): ReplanChanges {
  const database = runtime.database;
  const project = runtime.options.project;
  return store.transaction(database, () => {
    const dropped = closeDropped(runtime, prepared, replanId, now);
    const creation = createTasks(runtime, prepared, inheritorCount(prepared), now);
    const rewired = rewire(runtime, prepared, creation.byKey);
    keep(runtime, prepared, now);
    if (prepared.input.maxConcurrentSessions !== undefined) {
      store.storeMaxConcurrent(database, project, prepared.input.maxConcurrentSessions);
      runtime.maxConcurrentSessions = prepared.input.maxConcurrentSessions;
    }
    const notes = writeHandoffs(runtime, prepared, handoffs, replanId, now, creation.inheritors);
    const stopped: ReplanStopped[] = handoffs.map((handoff) => ({
      taskId: handoff.taskId,
      title: handoff.title,
      sessionId: handoff.sessionId,
      memo: handoff.memo,
    }));
    const changes: ReplanChanges = {
      stopped,
      created: creation.created,
      createdIds: creation.ids,
      dropped,
      kept: prepared.keep,
      rewired,
      notes,
    };
    replanStore.insertReplan(database, {
      id: replanId,
      project,
      reason: prepared.input.reason,
      before: prepared.before,
      after: changes,
      createdAt: now,
      undoneAt: null,
    });
    return changes;
  });
}

function apply(
  runtime: Runtime,
  prepared: Prepared,
  memos: ReadonlyMap<string, string>,
): Effect.Effect<ReplanResult, OrchestratorError> {
  return Effect.gen(function* () {
    const now = yield* nowMillis;
    const replanId = newId("rp");
    const handoffs = yield* collect(runtime, memos);
    const changes = yield* Effect.sync(() => write(runtime, prepared, handoffs, replanId, now));
    runtime.replanning = false;
    yield* Effect.sync(() => runtime.publish());
    const started =
      prepared.input.resume === false ? [] : yield* scheduling.scheduleEffect(runtime);
    yield* Effect.sync(() => runtime.publish());
    return {
      replanId,
      aborted: null,
      stopped: changes.stopped,
      created: changes.created,
      dropped: changes.dropped,
      kept: changes.kept,
      rewired: changes.rewired,
      started,
    };
  });
}

function stopSessions(runtime: Runtime, ids: readonly string[], now: number): string[] {
  const database = runtime.database;
  for (const sessionId of ids) {
    runtime.runs.delete(sessionId);
    void runtime.workers
      .get(sessionId)
      ?.abort()
      .catch(() => undefined);
    store.updateSession(database, sessionId, { status: "stopped" }, now);
    store.deleteAssignmentsOfSession(database, sessionId);
  }
  return [...ids];
}

function restoreState(runtime: Runtime, record: PreparedUndo["record"], now: number): string[] {
  const database = runtime.database;
  const project = runtime.options.project;
  for (const id of record.after.createdIds) store.deleteTask(database, id);
  for (const noteId of record.after.notes) store.deleteNote(database, noteId);
  for (const task of record.before.tasks) {
    const status = task.status === "running" ? "waiting" : task.status;
    store.setTaskStatus(database, task.id, status, now);
    store.clearDependencies(database, task.id);
    for (const dependency of task.dependsOn) {
      store.addDependency(database, project, task.id, dependency);
    }
  }
  for (const round of record.before.rounds) {
    store.insertRound(database, project, round.id, round.title, now);
  }
  store.storeMaxConcurrent(database, project, record.before.maxConcurrentSessions);
  runtime.maxConcurrentSessions = record.before.maxConcurrentSessions;
  replanStore.markUndone(database, record.id, now);
  return [...record.after.createdIds];
}

function restore(
  runtime: Runtime,
  prepared: PreparedUndo,
): Effect.Effect<ReplanUndoResult, OrchestratorError> {
  return Effect.gen(function* () {
    const now = yield* nowMillis;
    const stoppedSessions = yield* Effect.sync(() => stopSessions(runtime, prepared.targets, now));
    const deletedTasks = yield* Effect.sync(() =>
      store.transaction(runtime.database, () => restoreState(runtime, prepared.record, now)),
    );
    runtime.replanning = false;
    yield* Effect.sync(() => runtime.publish());
    const started = yield* scheduling.scheduleEffect(runtime);
    yield* Effect.sync(() => runtime.publish());
    return {
      replanId: prepared.record.id,
      reason: prepared.record.reason,
      restoredTasks: prepared.record.before.tasks.map((task) => task.id),
      deletedTasks,
      stoppedSessions,
      started,
    };
  });
}

export const applying = { apply, restore };
