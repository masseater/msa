import { withAbortSignal } from "@msa/chord/context";
import { Cause, Effect, Exit } from "effect";

import { toPromise } from "./bridge.ts";
import { terminate } from "./scheduler-finalize.ts";
import { loadScopes } from "./scheduler-load.ts";
import {
  erased,
  missingMigration,
  parentOf,
  withAbortMark,
  withState,
} from "./scheduler-records.ts";
import { runReservation } from "./scheduler-run.ts";
import type { SchedulerState } from "./scheduler-state.ts";
import type {
  AnyTaskRecord,
  Invocation,
  RegistrySnapshot,
  Reservation,
  RunnableTaskRecord,
  TaskId,
  TaskInspection,
  Transaction,
} from "./scheduler-types.ts";

type Reserving = {
  readonly reservations: Reservation[];
  abandoned: TaskId[];
  snapshot: RegistrySnapshot | undefined;
};

const createInvocation = (
  state: SchedulerState,
  record: AnyTaskRecord,
  mode: "run" | "abort",
): Invocation => {
  const controller = new AbortController();
  const { promise: done, resolve: finish } = Promise.withResolvers<void>();
  const invocation: Invocation = {
    taskId: record.id,
    conversationId: record.conversationId,
    mode,
    controller,
    context: withAbortSignal(controller.signal, state.options.context),
    watches: new Set(),
    ended: false,
    done,
    finish: () => finish(),
  };
  state.invocations.set(record.id, invocation);
  return invocation;
};

const reserveOne = Effect.fn("reserveOne")(function* (
  state: SchedulerState,
  tx: Transaction,
  id: TaskId,
  reserving: Reserving,
) {
  const { graph } = state;
  const record = graph.live.get(id);
  if (
    record === undefined ||
    record.state.status === "completing" ||
    state.invocations.has(id) ||
    graph.waitingOn(record, true).length > 0
  ) {
    graph.runnable.delete(id);
    return;
  }
  const runnable = record as RunnableTaskRecord;
  const mode = record.abortRequested ? "abort" : "run";
  if (mode === "run" && !record.background && graph.belowCancelled(parentOf(record))) {
    state.cascadePending = true;
    state.wake.reconcile();
    return;
  }
  const snapshot = (reserving.snapshot ??= state.options.registry.snapshot());
  const resolution = state.resolve(runnable, snapshot);
  if (resolution.kind === "blocked") {
    if (mode === "abort" && record.abortReason === undefined) {
      yield* terminate(state, tx, record, { status: "orphaned", reason: resolution.reason });
    }
    return;
  }
  if (resolution.record !== runnable || record.state.status !== "running") {
    tx.setTask(
      withState(resolution.record, {
        status: "running",
        checkpoint: resolution.record.state.checkpoint,
      }),
    );
  }
  graph.runnable.delete(id);
  const invocation = createInvocation(state, record, mode);
  reserving.reservations.push({ invocation, task: resolution.task, snapshot });
});

const reserveIn = Effect.fn("reserveIn")(function* (
  state: SchedulerState,
  tx: Transaction,
  reserving: Reserving,
) {
  if (!state.enabled || state.closing) return;
  for (const id of state.abandoned) {
    const record = state.graph.live.get(id);
    if (record !== undefined && !record.abortRequested)
      tx.setTask(withAbortMark(record, "restart"));
  }
  if (state.abandoned.size > 0) {
    reserving.abandoned = [...state.abandoned];
    return;
  }
  yield* loadScopes(state, false);
  yield* Effect.forEach([...state.graph.runnable], (id) => reserveOne(state, tx, id, reserving), {
    discard: true,
  });
});

const reserve = Effect.fn("reserve")(function* (state: SchedulerState) {
  const reserving: Reserving = { reservations: [], abandoned: [], snapshot: undefined };
  const change = yield* toPromise((tx: Transaction) => reserveIn(state, tx, reserving));
  const exit = yield* Effect.exit(
    Effect.promise(() => state.options.session.commitWith(change, state.options.context)),
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

const drainPasses = Effect.fn("drainPasses")(function* (state: SchedulerState) {
  const start = yield* toPromise((reservation: Reservation) => runReservation(state, reservation));
  while (state.dirty && state.enabled && !state.closing) {
    state.dirty = false;
    for (const reservation of yield* reserve(state)) void start(reservation);
  }
});

const drain = Effect.fn("drain")(function* (state: SchedulerState) {
  const exit = yield* Effect.exit(drainPasses(state));
  if (Exit.isFailure(exit)) state.failSession(Cause.squash(exit.cause));
  state.draining = false;
  if (state.dirty) kick(state);
});

export const kick = (state: SchedulerState): void => {
  state.dirty = true;
  if (state.draining || !state.enabled || state.closing) return;
  state.draining = true;
  queueMicrotask(() => void Effect.runPromise(drain(state)));
};

const inspectTask = (
  state: SchedulerState,
  record: AnyTaskRecord,
  snapshot: RegistrySnapshot,
): TaskInspection["state"] => {
  if (state.invocations.has(record.id)) return { kind: "running" };
  if (record.state.status === "completing") return { kind: "completing" };
  const on = state.graph.waitingOn(record);
  if (on.length > 0) return { kind: "waiting", on };
  const fit = state.fit(record, snapshot.task(record.kind));
  if ("reason" in fit) return { kind: "blocked", ...fit };
  if (fit.migrates && fit.task.definition.migrate === undefined) {
    return {
      kind: "blocked",
      reason: "migration_failed",
      error: missingMigration(record, erased(fit.task)),
    };
  }
  return { kind: "ready", migrates: fit.migrates };
};

export const inspectScheduler = Effect.fn("inspectScheduler")(function* (
  state: SchedulerState,
  snapshot: RegistrySnapshot,
) {
  yield* loadScopes(state, false);
  const tasks: TaskInspection[] = [];
  for (const record of state.graph.live.values())
    tasks.push({ record, state: inspectTask(state, record, snapshot) });
  const scheduling = state.closing ? "closing" : state.enabled ? "running" : "paused";
  return { scheduling, tasks } as const;
});
