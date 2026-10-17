import type { JsonValue } from "@msa/chord";
import { Effect } from "effect";

import { loadChain, loadScopes } from "./scheduler-load.ts";
import { overlayOf, parentOf, withState } from "./scheduler-records.ts";
import type { SchedulerState } from "./scheduler-state.ts";
import type {
  AnyTaskRecord,
  Checkpoint,
  ErasedRunningTask,
  Invocation,
  NextTaskState,
  Overlay,
  SchedulerOutcome,
  TaskId,
  Transaction,
} from "./scheduler-types.ts";

const finalizeOne = Effect.fn("finalizeOne")(function* (
  state: SchedulerState,
  tx: Transaction,
  record: AnyTaskRecord,
  overlay: Overlay,
) {
  if (record.state.status !== "completing") return undefined;
  const outcome = record.state.outcome;
  const terminal = withState(record, { status: "terminal", outcome });
  tx.setTask(terminal);
  (overlay.tasks as Map<TaskId, AnyTaskRecord>).set(record.id, terminal);
  if (outcome.status === "faulted" || outcome.status === "orphaned") {
    yield* Effect.promise(() => state.options.settleOutcome(tx, record, outcome));
  }
  return state.graph.nearestLiveAbove(record, overlay);
});

export const finalize = Effect.fn("finalize")(function* (state: SchedulerState, tx: Transaction) {
  const { graph } = state;
  let round = [...graph.finalizeChecks];
  graph.finalizeChecks.clear();
  const done = new Set<TaskId>();
  const overlay = overlayOf(tx);
  while (round.length > 0) {
    const next = new Set<TaskId>();
    for (const id of round) {
      const record = overlay.tasks.get(id) ?? graph.live.get(id);
      if (record?.state.status !== "completing" || done.has(id)) continue;
      if (graph.hasOwnedLive(id, overlay, done)) continue;
      done.add(id);
      const above = yield* finalizeOne(state, tx, record, overlay);
      if (above?.state.status === "completing") next.add(above.id);
    }
    round = [...next];
  }
});

export const terminate = Effect.fn("terminate")(function* (
  state: SchedulerState,
  tx: Transaction,
  record: AnyTaskRecord,
  outcome: SchedulerOutcome,
) {
  yield* loadScopes(state, false);
  if (state.graph.hasOwnedLive(record.id, overlayOf(tx))) {
    tx.setTask(withState(record, { status: "completing", outcome }));
    return;
  }
  tx.setTask(withState(record, { status: "terminal", outcome }));
  yield* Effect.promise(() => state.options.settleOutcome(tx, record, outcome));
});

const waitTargets = Effect.fn("waitTargets")(function* (
  state: SchedulerState,
  current: ErasedRunningTask,
  on: readonly TaskId[],
  policy: string,
  overlay: Overlay,
) {
  const targets: TaskId[] = [];
  for (const id of on) {
    const member =
      overlay.tasks.get(id) ??
      state.graph.live.get(id) ??
      (yield* Effect.promise(() => state.options.storage.task(id, state.options.context)));
    if (member === undefined) throw new Error(`Task ${id} does not exist`);
    if (policy === "failFast" && member.owner !== current.id) {
      throw new Error(
        `Task ${current.id} can wait failFast only on tasks it owns; ${id} is not one`,
      );
    }
    if (member.state.status !== "terminal" && member.owner !== current.id) targets.push(id);
  }
  return targets;
});

const waitCycle = Effect.fn("waitCycle")(function* (
  state: SchedulerState,
  task: TaskId,
  on: readonly TaskId[],
  overlay: Overlay,
) {
  yield* loadScopes(state, false);
  return findCycle(state, { task, on, overlay });
});

type CycleQuery = {
  readonly task: TaskId;
  readonly on: readonly TaskId[];
  readonly overlay: Overlay;
};

const findCycle = (state: SchedulerState, query: CycleQuery): TaskId[] | undefined => {
  const { graph } = state;
  const { task, overlay } = query;
  const from = new Map<TaskId, TaskId | undefined>();
  const walked = new Set<TaskId>();
  const pending: TaskId[] = [];
  const reach = (id: TaskId, via: TaskId | undefined): void => {
    if (from.has(id)) return;
    from.set(id, via);
    pending.push(id);
  };
  for (const id of query.on) reach(id, undefined);
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (id === task) return pathTo(from, id);
    const record = overlay.tasks.get(id) ?? graph.live.get(id);
    if (record === undefined || record.state.status === "terminal") continue;
    if (record.state.status === "waiting" && !record.abortRequested) {
      for (const member of record.state.on) reach(member, id);
    }
    if (walked.has(id)) continue;
    walked.add(id);
    const found: TaskId[] = [];
    for (const { id: below, node, live } of graph.walkDown(id, {
      overlay,
      enter: (next) => !walked.has(next),
    })) {
      if (live === undefined || node.background) continue;
      found.push(below);
      reach(below, id);
    }
    for (const below of found) walked.add(below);
  }
  return undefined;
};

const pathTo = (from: ReadonlyMap<TaskId, TaskId | undefined>, end: TaskId): TaskId[] => {
  const steps: TaskId[] = [];
  for (let at: TaskId | undefined = end; at !== undefined; at = from.get(at)) steps.unshift(at);
  return steps;
};

const validateWait = Effect.fn("validateWait")(function* (
  state: SchedulerState,
  tx: Transaction,
  invocation: Invocation,
  current: ErasedRunningTask,
  next: Extract<NextTaskState<Checkpoint, JsonValue>, { status: "waiting" }>,
) {
  if (invocation.mode === "abort")
    throw new Error(`Abort handler of task ${current.id} cannot wait`);
  const overlay = overlayOf(tx);
  const targets = yield* waitTargets(state, current, next.on, next.policy, overlay);
  if (targets.length === 0) return;
  const cycle = yield* waitCycle(state, current.id, targets, overlay);
  if (cycle !== undefined) {
    throw new Error(
      `Task ${current.id} cannot wait on ${cycle[0]}: ${[current.id, ...cycle].join(" -> ")} is a wait cycle`,
    );
  }
});

export const commitState = Effect.fn("commitState")(function* (
  state: SchedulerState,
  tx: Transaction,
  invocation: Invocation,
  current: ErasedRunningTask,
  next: NextTaskState<Checkpoint, JsonValue>,
) {
  if (next.status === "waiting") yield* validateWait(state, tx, invocation, current, next);
  if (next.status === "terminal") {
    const overlay = overlayOf(tx);
    yield* loadScopes(state, false);
    yield* Effect.forEach(
      [...overlay.tasks.values()],
      (record) => loadChain(state, parentOf(record), overlay),
      { discard: true },
    );
    if (state.graph.hasOwnedLive(current.id, overlay)) {
      tx.setTask(withState(current, { status: "completing", outcome: next.outcome }));
      return;
    }
  }
  tx.setTask(withState(current, next));
});
