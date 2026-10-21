import contextModule from "@msa/chord/context";
import { Cause, Effect, Exit } from "effect";

import stepModule from "../step.ts";
import bridge from "./bridge.ts";
import schedulerFinalize from "./scheduler-finalize.ts";
import schedulerLoad from "./scheduler-load.ts";
import schedulerRecords from "./scheduler-records.ts";
import schedulerRun from "./scheduler-run.ts";
import type schedulerStateTypes from "./scheduler-state.types.ts";
import type schedulerTypesModule from "./scheduler-types.types.ts";

const { withAbortSignal } = contextModule;

const { erased, missingMigration, parentOf, withAbortMark, withState } = schedulerRecords;
const { terminate } = schedulerFinalize;
const { eachStep, settleStep, thenStep } = stepModule;
const { loadPending } = schedulerLoad;
const { toPromise } = bridge;
const { runReservation } = schedulerRun;

type Reserving = {
  readonly reservations: schedulerTypesModule.Reservation[];
  abandoned: schedulerTypesModule.TaskId[];
  snapshot: schedulerTypesModule.RegistrySnapshot | undefined;
};

const createInvocation = (
  state: schedulerStateTypes.SchedulerState,
  record: schedulerTypesModule.AnyTaskRecord,
  mode: "run" | "abort",
): schedulerTypesModule.Invocation => {
  const controller = new AbortController();
  const { promise: done, resolve: finish } = Promise.withResolvers<void>();
  const invocation: schedulerTypesModule.Invocation = {
    context: withAbortSignal(controller.signal, state.options.context),
    controller,
    conversationId: record.conversationId,
    done,
    ended: false,
    finish: () => finish(),
    mode,
    taskId: record.id,
    watches: new Set(),
  };
  state.invocations.set(record.id, invocation);
  return invocation;
};

const reserveOne = (
  state: schedulerStateTypes.SchedulerState,
  tx: schedulerTypesModule.Transaction,
  id: schedulerTypesModule.TaskId,
  reserving: Reserving,
): Effect.Effect<void> => {
  const { graph } = state;
  const record = graph.live.get(id);
  if (
    record === undefined ||
    record.state.status === "completing" ||
    state.invocations.has(id) ||
    graph.waitingOn(record, true).length > 0
  ) {
    graph.runnable.delete(id);
    return Effect.void;
  }
  const runnable = record as schedulerTypesModule.RunnableTaskRecord;
  const mode = record.abortRequested ? "abort" : "run";
  if (mode === "run" && !record.background && graph.belowCancelled(parentOf(record))) {
    state.cascadePending = true;
    state.wake.reconcile();
    return Effect.void;
  }
  const snapshot = (reserving.snapshot ??= state.options.registry.snapshot());
  const resolution = state.resolve(runnable, snapshot);
  if (resolution.kind === "blocked") {
    if (mode === "abort" && record.abortReason === undefined) {
      return terminate(state, tx, record, { reason: resolution.reason, status: "orphaned" });
    }
    return Effect.void;
  }
  if (resolution.record !== runnable || record.state.status !== "running") {
    tx.setTask(
      withState(resolution.record, {
        checkpoint: resolution.record.state.checkpoint,
        status: "running",
      }),
    );
  }
  graph.runnable.delete(id);
  const invocation = createInvocation(state, record, mode);
  reserving.reservations.push({ invocation, snapshot, task: resolution.task });
  return Effect.void;
};

const reserveIn = (
  state: schedulerStateTypes.SchedulerState,
  tx: schedulerTypesModule.Transaction,
  reserving: Reserving,
): schedulerTypesModule.Reservation[] | Promise<schedulerTypesModule.Reservation[]> => {
  if (!state.enabled || state.closing) return reserving.reservations;
  for (const id of state.abandoned) {
    const record = state.graph.live.get(id);
    if (record !== undefined && !record.abortRequested)
      tx.setTask(withAbortMark(record, "restart"));
  }
  if (state.abandoned.size > 0) {
    reserving.abandoned = [...state.abandoned];
    return reserving.reservations;
  }
  const pending = thenStep(loadPending(state), () =>
    eachStep([...state.graph.runnable], (id: schedulerTypesModule.TaskId) =>
      reserveOne(state, tx, id, reserving),
    ),
  );
  return settleStep(pending, () => reserving.reservations);
};

const reserve = Effect.fnUntraced(function* (state: schedulerStateTypes.SchedulerState) {
  const reserving: Reserving = { abandoned: [], reservations: [], snapshot: undefined };
  const exit = yield* Effect.exit(
    Effect.promise(() =>
      state.options.session.commitWith(
        (tx: schedulerTypesModule.Transaction) => reserveIn(state, tx, reserving),
        state.options.context,
      ),
    ),
  );
  if (Exit.isFailure(exit)) {
    for (const { invocation } of reserving.reservations) {
      state.invocations.delete(invocation.taskId);
      state.graph.runnable.add(invocation.taskId);
      invocation.finish();
    }
    return yield* Effect.failCause(exit.cause);
  }
  for (const id of reserving.abandoned) state.abandoned.delete(id);
  if (reserving.abandoned.length > 0) state.dirty = true;
  return reserving.reservations;
});

const drainPasses = Effect.fnUntraced(function* (state: schedulerStateTypes.SchedulerState) {
  const start = yield* toPromise((reservation: schedulerTypesModule.Reservation) =>
    runReservation(state, reservation),
  );
  while (state.dirty && state.enabled && !state.closing) {
    state.dirty = false;
    for (const reservation of yield* reserve(state)) void start(reservation);
  }
});

const drain = Effect.fnUntraced(function* (state: schedulerStateTypes.SchedulerState) {
  const exit = yield* Effect.exit(drainPasses(state));
  if (Exit.isFailure(exit)) state.failSession(Cause.squash(exit.cause));
  state.draining = false;
  if (state.dirty) kick(state);
});

const kick = (state: schedulerStateTypes.SchedulerState): void => {
  state.dirty = true;
  if (state.draining || !state.enabled || state.closing) return;
  state.draining = true;
  queueMicrotask(() => void Effect.runPromise(drain(state)));
};

const inspectTask = (
  state: schedulerStateTypes.SchedulerState,
  record: schedulerTypesModule.AnyTaskRecord,
  snapshot: schedulerTypesModule.RegistrySnapshot,
): schedulerTypesModule.TaskInspection["state"] => {
  if (state.invocations.has(record.id)) return { kind: "running" };
  if (record.state.status === "completing") return { kind: "completing" };
  const on = state.graph.waitingOn(record);
  if (on.length > 0) return { kind: "waiting", on };
  const fit = state.fit(record, snapshot.task(record.kind));
  if ("reason" in fit) return { kind: "blocked", ...fit };
  if (fit.migrates && fit.task.definition.migrate === undefined) {
    return {
      error: missingMigration(record, erased(fit.task)),
      kind: "blocked",
      reason: "migration_failed",
    };
  }
  return { kind: "ready", migrates: fit.migrates };
};

const inspectScheduler = Effect.fnUntraced(function* (
  state: schedulerStateTypes.SchedulerState,
  snapshot: schedulerTypesModule.RegistrySnapshot,
) {
  yield* loadPending(state);
  const tasks: schedulerTypesModule.TaskInspection[] = [];
  for (const record of state.graph.live.values())
    tasks.push({ record, state: inspectTask(state, record, snapshot) });
  const scheduling = state.closing ? "closing" : state.enabled ? "running" : "paused";
  return { scheduling, tasks } as const;
});

const schedulerReserve = {
  inspectScheduler,
  kick,
};

export default schedulerReserve;
