import { Effect } from "effect";

import type { OrchestratorError } from "./errors.ts";
import { newId } from "./ids.ts";
import { replanStore } from "./replan-store.ts";
import { fail, unique } from "./replan-support.ts";
import type { Prepared } from "./replan.ts";
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
  Task,
} from "./types.ts";

interface Handoff {
  taskId: string;
  threadId: string;
  title: string;
  memo: string;
  repo: RepoState;
}

interface Creation {
  created: ReplanCreated[];
  inheritors: Map<string, string[]>;
  byKey: Map<string, string>;
}

function collect(runtime: Runtime, memos: ReadonlyMap<string, string>): Effect.Effect<Handoff[]> {
  return Effect.gen(function* () {
    const database = runtime.database;
    const handoffs: Handoff[] = [];
    for (const [threadId, memo] of memos) {
      for (const assignment of store.assignmentsOfThread(database, threadId)) {
        const task = store.getTask(database, assignment.taskId);
        if (task === undefined) continue;
        const repo = yield* repoStates.read(task.cwd);
        handoffs.push({ memo, repo, taskId: task.id, threadId, title: task.title });
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
    dropped.push({ reason: item.reason, taskId: task.id, title: task.title });
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

function inherited(sources: readonly Task[], pick: (task: Task) => string): string {
  return sources
    .map(pick)
    .filter((value) => value.trim() !== "")
    .join("\n\n");
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
  now: number,
): Task {
  return {
    condition: null,
    createdAt: now,
    currentState: input.currentState ?? inherited(sources, (source) => source.currentState),
    cwd: input.cwd ?? sources[0]?.cwd ?? runtime.options.cwd,
    goalState: input.goalState ?? inherited(sources, (source) => source.goalState),
    id: newId("t"),
    kind: "work",
    model: input.model ?? null,
    project: runtime.options.project,
    round: roundFor(input, sources),
    status: "waiting",
    thinkingLevel: input.thinkingLevel ?? null,
    title: input.title,
    updatedAt: now,
  };
}

function createTasks(runtime: Runtime, prepared: Prepared, now: number): Creation {
  const database = runtime.database;
  const project = runtime.options.project;
  const closed = new Set(prepared.sources);
  const created: ReplanCreated[] = [];
  const inheritors = new Map<string, string[]>();
  const byKey = new Map<string, string>();
  const pending: { taskId: string; refs: readonly string[]; explicit: boolean }[] = [];
  for (const entry of prepared.entries) {
    const sources = entry.from.flatMap((id) => prepared.views.get(id) ?? []);
    const task = newTask(runtime, entry.input, sources, now);
    store.insertTask(database, task);
    const review = rounds.ensureReview(runtime, task.round, now);
    rounds.attachReview(runtime, review, task.id, now);
    if (entry.key !== null) byKey.set(entry.key, task.id);
    created.push({ from: entry.from, taskId: task.id, title: task.title });
    for (const source of entry.from) {
      inheritors.set(source, [...(inheritors.get(source) ?? []), task.id]);
    }
    pending.push({
      explicit: entry.input.dependsOn !== undefined,
      refs: entry.input.dependsOn ?? sources.flatMap((source) => source.dependsOn),
      taskId: task.id,
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
  return { byKey, created, inheritors };
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
    rewired.push({ dependsOn: refs, taskId: item.taskId });
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
    const creation = createTasks(runtime, prepared, now);
    const rewired = rewire(runtime, prepared, creation.byKey);
    keep(runtime, prepared, now);
    if (prepared.input.maxConcurrentThreads !== undefined) {
      store.storeMaxConcurrent(database, project, prepared.input.maxConcurrentThreads);
      runtime.maxConcurrentThreads = prepared.input.maxConcurrentThreads;
    }
    writeHandoffs(runtime, prepared, handoffs, replanId, now, creation.inheritors);
    const stopped: ReplanStopped[] = handoffs.map((handoff) => ({
      memo: handoff.memo,
      taskId: handoff.taskId,
      threadId: handoff.threadId,
      title: handoff.title,
    }));
    const changes: ReplanChanges = {
      created: creation.created,
      dropped,
      kept: prepared.keep,
      rewired,
      stopped,
    };
    replanStore.insertReplan(database, {
      after: changes,
      createdAt: now,
      id: replanId,
      project,
      reason: prepared.input.reason,
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
      aborted: null,
      created: changes.created,
      dropped: changes.dropped,
      kept: changes.kept,
      replanId,
      rewired: changes.rewired,
      started,
      stopped: changes.stopped,
    };
  });
}

export const applying = { apply };
