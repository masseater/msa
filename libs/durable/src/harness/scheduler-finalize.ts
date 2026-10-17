import type { JsonValue } from "@msa/chord";
import { Effect, Function } from "effect";

import { eachStep, thenStep } from "../step.ts";
import { loadChain, loadPending } from "./scheduler-load.ts";
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
  Dual2,
  Dual4,
  Dual5,
} from "./scheduler-types.ts";

type Finalizing = {
  readonly state: SchedulerState;
  readonly tx: Transaction;
  readonly done: Set<TaskId>;
  readonly overlay: Overlay;
};

const climb = ({ state, overlay }: Finalizing, record: AnyTaskRecord, next: Set<TaskId>): void => {
  const above = state.graph.nearestLiveAbove(record, overlay);
  if (above?.state.status === "completing") next.add(above.id);
};

const finalizeOne = (run: Finalizing, id: TaskId, next: Set<TaskId>): Effect.Effect<void> => {
  const { state, tx, done, overlay } = run;
  const record = overlay.tasks.get(id) ?? state.graph.live.get(id);
  if (record?.state.status !== "completing" || done.has(id)) return Effect.void;
  if (state.graph.hasOwnedLive(id, overlay, done)) return Effect.void;
  done.add(id);
  const outcome = record.state.outcome;
  const terminal = withState(record, { status: "terminal", outcome });
  tx.setTask(terminal);
  (overlay.tasks as Map<TaskId, AnyTaskRecord>).set(record.id, terminal);
  if (outcome.status !== "faulted" && outcome.status !== "orphaned") {
    climb(run, record, next);
    return Effect.void;
  }
  return Effect.map(
    Effect.promise(() => state.options.settleOutcome(tx, record, outcome)),
    () => climb(run, record, next),
  );
};

const finalizeFrom = (run: Finalizing, first: readonly TaskId[]): Effect.Effect<void> => {
  let round = first;
  while (round.length > 0) {
    const next = new Set<TaskId>();
    const pending = eachStep(round, (id: TaskId) => finalizeOne(run, id, next));
    if (pending !== Effect.void) {
      return Effect.flatMap(pending, () => finalizeFrom(run, [...next]));
    }
    round = [...next];
  }
  return Effect.void;
};

export const finalize: Dual2<SchedulerState, Transaction, Effect.Effect<void>> = Function.dual(
  2,
  (state: SchedulerState, tx: Transaction): Effect.Effect<void> => {
    const round = [...state.graph.finalizeChecks];
    state.graph.finalizeChecks.clear();
    return finalizeFrom({ state, tx, done: new Set(), overlay: overlayOf(tx) }, round);
  },
);

const settleTerminal = (
  state: SchedulerState,
  tx: Transaction,
  record: AnyTaskRecord,
  outcome: SchedulerOutcome,
): Effect.Effect<void> => {
  if (state.graph.hasOwnedLive(record.id, overlayOf(tx))) {
    tx.setTask(withState(record, { status: "completing", outcome }));
    return Effect.void;
  }
  tx.setTask(withState(record, { status: "terminal", outcome }));
  return Effect.promise(() => state.options.settleOutcome(tx, record, outcome));
};

export const terminate: Dual4<
  SchedulerState,
  Transaction,
  AnyTaskRecord,
  SchedulerOutcome,
  Effect.Effect<void>
> = Function.dual(
  4,
  (
    state: SchedulerState,
    tx: Transaction,
    record: AnyTaskRecord,
    outcome: SchedulerOutcome,
  ): Effect.Effect<void> =>
    thenStep(loadPending(state), () => settleTerminal(state, tx, record, outcome)),
);

const waitTargets = Effect.fnUntraced(function* (
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

const waitCycle = Effect.fnUntraced(function* (
  state: SchedulerState,
  task: TaskId,
  on: readonly TaskId[],
  overlay: Overlay,
) {
  yield* loadPending(state);
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

const validateWait = Effect.fnUntraced(function* (
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

const settleState = (
  state: SchedulerState,
  tx: Transaction,
  current: ErasedRunningTask,
  next: NextTaskState<Checkpoint, JsonValue>,
): void => {
  if (next.status === "terminal" && state.graph.hasOwnedLive(current.id, overlayOf(tx))) {
    tx.setTask(withState(current, { status: "completing", outcome: next.outcome }));
    return;
  }
  tx.setTask(withState(current, next));
};

const loadOverlay = (state: SchedulerState, tx: Transaction): Effect.Effect<void> => {
  const overlay = overlayOf(tx);
  return thenStep(loadPending(state), () =>
    eachStep([...overlay.tasks.values()], (record: AnyTaskRecord) =>
      loadChain(state, parentOf(record), overlay),
    ),
  );
};

export const commitState: Dual5<
  SchedulerState,
  Transaction,
  Invocation,
  ErasedRunningTask,
  NextTaskState<Checkpoint, JsonValue>,
  Effect.Effect<void>
> = Function.dual(
  5,
  (
    state: SchedulerState,
    tx: Transaction,
    invocation: Invocation,
    current: ErasedRunningTask,
    next: NextTaskState<Checkpoint, JsonValue>,
  ): Effect.Effect<void> => {
    const ready =
      next.status === "waiting"
        ? validateWait(state, tx, invocation, current, next)
        : next.status === "terminal"
          ? loadOverlay(state, tx)
          : Effect.void;
    return thenStep(ready, () => {
      settleState(state, tx, current, next);
      return Effect.void;
    });
  },
);
