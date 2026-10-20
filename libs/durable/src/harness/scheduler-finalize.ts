import type chordTypes from "@msa/chord/index.types";
import { Effect, Function } from "effect";

import stepModule from "../step.ts";
import schedulerLoad from "./scheduler-load.ts";
import schedulerRecords from "./scheduler-records.ts";
import type schedulerStateTypes from "./scheduler-state.types.ts";
import type schedulerTypesModule from "./scheduler-types.types.ts";

const { overlayOf, parentOf, withState } = schedulerRecords;
const { eachStep, thenStep } = stepModule;
const { loadChain, loadPending } = schedulerLoad;

type Finalizing = {
  readonly state: schedulerStateTypes.SchedulerState;
  readonly tx: schedulerTypesModule.Transaction;
  readonly done: Set<schedulerTypesModule.TaskId>;
  readonly overlay: schedulerTypesModule.Overlay;
};

const climb = (
  { state, overlay }: Finalizing,
  record: schedulerTypesModule.AnyTaskRecord,
  next: Set<schedulerTypesModule.TaskId>,
): void => {
  const above = state.graph.nearestLiveAbove(record, overlay);
  if (above?.state.status === "completing") next.add(above.id);
};

const finalizeOne = (
  run: Finalizing,
  id: schedulerTypesModule.TaskId,
  next: Set<schedulerTypesModule.TaskId>,
): Effect.Effect<void> => {
  const { state, tx, done, overlay } = run;
  const record = overlay.tasks.get(id) ?? state.graph.live.get(id);
  if (record?.state.status !== "completing" || done.has(id)) return Effect.void;
  if (state.graph.hasOwnedLive(id, overlay, done)) return Effect.void;
  done.add(id);
  const outcome = record.state.outcome;
  const terminal = withState(record, { outcome, status: "terminal" });
  tx.setTask(terminal);
  (overlay.tasks as Map<schedulerTypesModule.TaskId, schedulerTypesModule.AnyTaskRecord>).set(
    record.id,
    terminal,
  );
  if (outcome.status !== "faulted" && outcome.status !== "orphaned") {
    climb(run, record, next);
    return Effect.void;
  }
  return Effect.map(
    Effect.promise(() => state.options.settleOutcome(tx, record, outcome)),
    () => climb(run, record, next),
  );
};

const finalizeFrom = (
  run: Finalizing,
  first: readonly schedulerTypesModule.TaskId[],
): Effect.Effect<void> => {
  let round = first;
  while (round.length > 0) {
    const next = new Set<schedulerTypesModule.TaskId>();
    const pending = eachStep(round, (id: schedulerTypesModule.TaskId) =>
      finalizeOne(run, id, next),
    );
    if (pending !== Effect.void) {
      return Effect.flatMap(pending, () => finalizeFrom(run, [...next]));
    }
    round = [...next];
  }
  return Effect.void;
};

const finalize: schedulerTypesModule.Dual2<
  schedulerStateTypes.SchedulerState,
  schedulerTypesModule.Transaction,
  Effect.Effect<void>
> = Function.dual(
  2,
  (
    state: schedulerStateTypes.SchedulerState,
    tx: schedulerTypesModule.Transaction,
  ): Effect.Effect<void> => {
    const round = [...state.graph.finalizeChecks];
    state.graph.finalizeChecks.clear();
    return finalizeFrom({ done: new Set(), overlay: overlayOf(tx), state, tx }, round);
  },
);

const settleTerminal = (
  state: schedulerStateTypes.SchedulerState,
  tx: schedulerTypesModule.Transaction,
  record: schedulerTypesModule.AnyTaskRecord,
  outcome: schedulerTypesModule.SchedulerOutcome,
): Effect.Effect<void> => {
  if (state.graph.hasOwnedLive(record.id, overlayOf(tx))) {
    tx.setTask(withState(record, { outcome, status: "completing" }));
    return Effect.void;
  }
  tx.setTask(withState(record, { outcome, status: "terminal" }));
  return Effect.promise(() => state.options.settleOutcome(tx, record, outcome));
};

const terminate: schedulerTypesModule.Dual4<
  schedulerStateTypes.SchedulerState,
  schedulerTypesModule.Transaction,
  schedulerTypesModule.AnyTaskRecord,
  schedulerTypesModule.SchedulerOutcome,
  Effect.Effect<void>
> = Function.dual(
  4,
  (
    state: schedulerStateTypes.SchedulerState,
    tx: schedulerTypesModule.Transaction,
    record: schedulerTypesModule.AnyTaskRecord,
    outcome: schedulerTypesModule.SchedulerOutcome,
  ): Effect.Effect<void> =>
    thenStep(loadPending(state), () => settleTerminal(state, tx, record, outcome)),
);

const waitTargets = Effect.fnUntraced(function* (
  state: schedulerStateTypes.SchedulerState,
  current: schedulerTypesModule.ErasedRunningTask,
  on: readonly schedulerTypesModule.TaskId[],
  policy: string,
  overlay: schedulerTypesModule.Overlay,
) {
  const targets: schedulerTypesModule.TaskId[] = [];
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
  state: schedulerStateTypes.SchedulerState,
  task: schedulerTypesModule.TaskId,
  on: readonly schedulerTypesModule.TaskId[],
  overlay: schedulerTypesModule.Overlay,
) {
  yield* loadPending(state);
  return findCycle(state, { on, overlay, task });
});

type CycleQuery = {
  readonly task: schedulerTypesModule.TaskId;
  readonly on: readonly schedulerTypesModule.TaskId[];
  readonly overlay: schedulerTypesModule.Overlay;
};

const findCycle = (
  state: schedulerStateTypes.SchedulerState,
  query: CycleQuery,
): schedulerTypesModule.TaskId[] | undefined => {
  const { graph } = state;
  const { task, overlay } = query;
  const from = new Map<schedulerTypesModule.TaskId, schedulerTypesModule.TaskId | undefined>();
  const walked = new Set<schedulerTypesModule.TaskId>();
  const pending: schedulerTypesModule.TaskId[] = [];
  const reach = (
    id: schedulerTypesModule.TaskId,
    via: schedulerTypesModule.TaskId | undefined,
  ): void => {
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
    const found: schedulerTypesModule.TaskId[] = [];
    for (const { id: below, node, live } of graph.walkDown(id, {
      enter: (next) => !walked.has(next),
      overlay,
    })) {
      if (live === undefined || node.background) continue;
      found.push(below);
      reach(below, id);
    }
    for (const below of found) walked.add(below);
  }
  return undefined;
};

const pathTo = (
  from: ReadonlyMap<schedulerTypesModule.TaskId, schedulerTypesModule.TaskId | undefined>,
  end: schedulerTypesModule.TaskId,
): schedulerTypesModule.TaskId[] => {
  const steps: schedulerTypesModule.TaskId[] = [];
  for (let at: schedulerTypesModule.TaskId | undefined = end; at !== undefined; at = from.get(at))
    steps.unshift(at);
  return steps;
};

const validateWait = Effect.fnUntraced(function* (
  state: schedulerStateTypes.SchedulerState,
  tx: schedulerTypesModule.Transaction,
  invocation: schedulerTypesModule.Invocation,
  current: schedulerTypesModule.ErasedRunningTask,
  next: Extract<
    schedulerTypesModule.NextTaskState<schedulerTypesModule.Checkpoint, chordTypes.JsonValue>,
    { status: "waiting" }
  >,
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
  state: schedulerStateTypes.SchedulerState,
  tx: schedulerTypesModule.Transaction,
  current: schedulerTypesModule.ErasedRunningTask,
  next: schedulerTypesModule.NextTaskState<schedulerTypesModule.Checkpoint, chordTypes.JsonValue>,
): void => {
  if (next.status === "terminal" && state.graph.hasOwnedLive(current.id, overlayOf(tx))) {
    tx.setTask(withState(current, { outcome: next.outcome, status: "completing" }));
    return;
  }
  tx.setTask(withState(current, next));
};

const loadOverlay = (
  state: schedulerStateTypes.SchedulerState,
  tx: schedulerTypesModule.Transaction,
): Effect.Effect<void> => {
  const overlay = overlayOf(tx);
  return thenStep(loadPending(state), () =>
    eachStep([...overlay.tasks.values()], (record: schedulerTypesModule.AnyTaskRecord) =>
      loadChain(state, parentOf(record), overlay),
    ),
  );
};

const commitState: schedulerTypesModule.Dual5<
  schedulerStateTypes.SchedulerState,
  schedulerTypesModule.Transaction,
  schedulerTypesModule.Invocation,
  schedulerTypesModule.ErasedRunningTask,
  schedulerTypesModule.NextTaskState<schedulerTypesModule.Checkpoint, chordTypes.JsonValue>,
  Effect.Effect<void>
> = Function.dual(
  5,
  (
    state: schedulerStateTypes.SchedulerState,
    tx: schedulerTypesModule.Transaction,
    invocation: schedulerTypesModule.Invocation,
    current: schedulerTypesModule.ErasedRunningTask,
    next: schedulerTypesModule.NextTaskState<schedulerTypesModule.Checkpoint, chordTypes.JsonValue>,
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

const schedulerFinalize = {
  commitState,
  finalize,
  terminate,
};

export default schedulerFinalize;
