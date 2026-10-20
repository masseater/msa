import { Cause, Effect, Exit } from "effect";

import errors from "../errors.ts";
import stepModule from "../step.ts";
import schedulerFinalize from "./scheduler-finalize.ts";
import schedulerRecords from "./scheduler-records.ts";
import schedulerRuntime from "./scheduler-runtime.ts";
import type schedulerStateTypes from "./scheduler-state.types.ts";
import type schedulerTypesModule from "./scheduler-types.types.ts";

const { canReserve, erased, jsonEqual, parentOf, withState } = schedulerRecords;
const { errorMessage } = errors;
const { settleStep } = stepModule;
const { terminate } = schedulerFinalize;
const { buildRuntime } = schedulerRuntime;

type Running = {
  task: schedulerTypesModule.AnyTask;
  snapshot: schedulerTypesModule.RegistrySnapshot;
  reported: schedulerTypesModule.ReportedTask;
};

const reportOldDefinition = (
  state: schedulerStateTypes.SchedulerState,
  current: schedulerTypesModule.ErasedRunningTask,
  running: Running,
  next: schedulerTypesModule.AnyTask | undefined,
): void => {
  if (running.reported !== undefined && running.reported.task === next) return;
  running.reported = { task: next };
  const cause = next === undefined ? "missing_task" : "incompatible_task";
  state.options.report(
    new Error(`Task ${current.id} keeps running under its old ${current.kind} definition`, {
      cause,
    }),
  );
};

const decide = (
  state: schedulerStateTypes.SchedulerState,
  tx: schedulerTypesModule.Transaction,
  current: schedulerTypesModule.ErasedRunningTask,
  previous: schedulerTypesModule.PhaseResult | undefined,
  running: Running,
): schedulerTypesModule.Decision => {
  if (current.abortRequested) return false;
  if (!current.background && state.graph.belowCancelled(parentOf(current))) {
    state.cascadePending = true;
    state.wake.reconcile();
    return false;
  }
  if (previous === undefined) return true;
  if (previous.failure !== undefined) return { fault: previous.failure.error };
  if (jsonEqual(current.state.checkpoint, previous.checkpoint)) {
    const message = `Task ${current.kind} phase ${previous.checkpoint.phase} returned without durable progress`;
    return { fault: new Error(message) };
  }
  running.snapshot = state.options.registry.snapshot();
  const next = running.snapshot.task(current.kind);
  if (next === running.task) return true;
  if (next !== undefined && canReserve(next, current)) {
    tx.setTask(withState(current, { checkpoint: current.state.checkpoint, status: "pending" }));
    return false;
  }
  reportOldDefinition(state, current, running, next);
  return true;
};

const stepIn = (
  state: schedulerStateTypes.SchedulerState,
  tx: schedulerTypesModule.Transaction,
  invocation: schedulerTypesModule.Invocation,
  choose: (
    tx: schedulerTypesModule.Transaction,
    current: schedulerTypesModule.ErasedRunningTask,
  ) => schedulerTypesModule.Decision,
): schedulerTypesModule.ErasedRunningTask | undefined | Promise<undefined> => {
  const found = state.graph.live.get(invocation.taskId);
  const current =
    found?.state.status === "running"
      ? (found as schedulerTypesModule.ErasedRunningTask)
      : undefined;
  const decision = current !== undefined && !state.closing ? choose(tx, current) : false;
  if (decision === true) return current;
  state.end(invocation);
  if (decision === false) return undefined;
  const message = errorMessage(decision.fault);
  return settleStep(
    terminate(state, tx, current!, { error: { message }, status: "faulted" }),
    () => undefined,
  );
};

const step = Effect.fnUntraced(function* (
  state: schedulerStateTypes.SchedulerState,
  invocation: schedulerTypesModule.Invocation,
  choose: (
    tx: schedulerTypesModule.Transaction,
    current: schedulerTypesModule.ErasedRunningTask,
  ) => schedulerTypesModule.Decision,
) {
  const exit = yield* Effect.exit(
    Effect.promise(() =>
      state.options.session.commitWith(
        (tx: schedulerTypesModule.Transaction) => stepIn(state, tx, invocation, choose),
        state.options.context,
      ),
    ),
  );
  if (Exit.isSuccess(exit)) return exit.value;
  state.end(invocation);
  state.failSession(Cause.squash(exit.cause));
  return undefined;
});

const runPhases = Effect.fnUntraced(function* (
  state: schedulerStateTypes.SchedulerState,
  reservation: schedulerTypesModule.Reservation,
) {
  const invocation = reservation.invocation;
  const running: Running = {
    reported: undefined,
    snapshot: reservation.snapshot,
    task: reservation.task,
  };
  const phase: schedulerTypesModule.Phase = {
    agent: undefined,
    snapshot: () => running.snapshot,
    task: () => running.task,
  };
  const runtime = buildRuntime({ invocation, phase, state });
  let previous: schedulerTypesModule.PhaseResult | undefined;
  for (;;) {
    const prior = previous;
    const current = yield* step(state, invocation, (tx, found) =>
      decide(state, tx, found, prior, running),
    );
    if (current === undefined || state.closing) return;
    const checkpoint = current.state.checkpoint;
    phase.agent = undefined;
    const exit = yield* Effect.exit(
      Effect.promise(() =>
        erased(running.task).phases[checkpoint.phase]!(current, runtime, invocation.context),
      ),
    );
    previous = Exit.isSuccess(exit)
      ? { checkpoint }
      : { checkpoint, failure: { error: Cause.squash(exit.cause) } };
  }
});

const runAbort = Effect.fnUntraced(function* (
  state: schedulerStateTypes.SchedulerState,
  reservation: schedulerTypesModule.Reservation,
) {
  const invocation = reservation.invocation;
  const current = state.graph.live.get(invocation.taskId) as
    | schedulerTypesModule.ErasedRunningTask
    | undefined;
  if (current === undefined || state.closing) return;
  const exit = yield* Effect.exit(
    Effect.promise(() => {
      const phase: schedulerTypesModule.Phase = {
        agent: undefined,
        snapshot: () => reservation.snapshot,
        task: () => reservation.task,
      };
      const runtime = buildRuntime({ invocation, phase, state });
      return erased(reservation.task).abort(current, runtime, invocation.context);
    }),
  );
  const failure = Exit.isFailure(exit) ? { error: Cause.squash(exit.cause) } : undefined;
  const message = `Abort handler of task ${invocation.taskId} returned without a terminal outcome`;
  yield* step(state, invocation, () => ({ fault: failure?.error ?? new Error(message) }));
});

const runReservation = Effect.fnUntraced(function* (
  state: schedulerStateTypes.SchedulerState,
  reservation: schedulerTypesModule.Reservation,
) {
  const invocation = reservation.invocation;
  const exit = yield* Effect.exit(
    invocation.mode === "run" ? runPhases(state, reservation) : runAbort(state, reservation),
  );
  if (Exit.isFailure(exit)) state.options.report(Cause.squash(exit.cause));
  state.end(invocation);
  invocation.finish();
  state.wake.kick();
});

const schedulerRun = {
  runReservation,
};

export default schedulerRun;
