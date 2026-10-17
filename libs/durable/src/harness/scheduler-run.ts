import { Cause, Effect, Exit } from "effect";

import { errorMessage } from "../errors.ts";
import { toPromise } from "./bridge.ts";
import { terminate } from "./scheduler-finalize.ts";
import { canReserve, erased, jsonEqual, parentOf, withState } from "./scheduler-records.ts";
import { buildRuntime } from "./scheduler-runtime.ts";
import type { SchedulerState } from "./scheduler-state.ts";
import type {
  AnyTask,
  Decision,
  ErasedRunningTask,
  Invocation,
  Phase,
  PhaseResult,
  RegistrySnapshot,
  ReportedTask,
  Reservation,
  Transaction,
} from "./scheduler-types.ts";

type Running = { task: AnyTask; snapshot: RegistrySnapshot; reported: ReportedTask };

const reportOldDefinition = (
  state: SchedulerState,
  current: ErasedRunningTask,
  running: Running,
  next: AnyTask | undefined,
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
  state: SchedulerState,
  tx: Transaction,
  current: ErasedRunningTask,
  previous: PhaseResult | undefined,
  running: Running,
): Decision => {
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
    tx.setTask(withState(current, { status: "pending", checkpoint: current.state.checkpoint }));
    return false;
  }
  reportOldDefinition(state, current, running, next);
  return true;
};

const stepIn = Effect.fn("stepIn")(function* (
  state: SchedulerState,
  tx: Transaction,
  invocation: Invocation,
  choose: (tx: Transaction, current: ErasedRunningTask) => Decision,
) {
  const found = state.graph.live.get(invocation.taskId);
  const current = found?.state.status === "running" ? (found as ErasedRunningTask) : undefined;
  const decision = current !== undefined && !state.closing ? choose(tx, current) : false;
  if (decision === true) return current;
  state.end(invocation);
  if (decision !== false) {
    const message = errorMessage(decision.fault);
    yield* terminate(state, tx, current!, { status: "faulted", error: { message } });
  }
  return undefined;
});

const step = Effect.fn("step")(function* (
  state: SchedulerState,
  invocation: Invocation,
  choose: (tx: Transaction, current: ErasedRunningTask) => Decision,
) {
  const change = yield* toPromise((tx: Transaction) => stepIn(state, tx, invocation, choose));
  const exit = yield* Effect.exit(
    Effect.promise(() => state.options.session.commitWith(change, state.options.context)),
  );
  if (Exit.isSuccess(exit)) return exit.value;
  state.end(invocation);
  state.failSession(Cause.squash(exit.cause));
  return undefined;
});

const runPhases = Effect.fn("runPhases")(function* (
  state: SchedulerState,
  reservation: Reservation,
) {
  const invocation = reservation.invocation;
  const running: Running = {
    task: reservation.task,
    snapshot: reservation.snapshot,
    reported: undefined,
  };
  const phase: Phase = {
    snapshot: () => running.snapshot,
    task: () => running.task,
    agent: undefined,
  };
  const runtime = buildRuntime({ state, invocation, phase });
  let previous: PhaseResult | undefined;
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

const runAbort = Effect.fn("runAbort")(function* (state: SchedulerState, reservation: Reservation) {
  const invocation = reservation.invocation;
  const current = state.graph.live.get(invocation.taskId) as ErasedRunningTask | undefined;
  if (current === undefined || state.closing) return;
  const exit = yield* Effect.exit(
    Effect.promise(() => {
      const phase: Phase = {
        snapshot: () => reservation.snapshot,
        task: () => reservation.task,
        agent: undefined,
      };
      const runtime = buildRuntime({ state, invocation, phase });
      return erased(reservation.task).abort(current, runtime, invocation.context);
    }),
  );
  const failure = Exit.isFailure(exit) ? { error: Cause.squash(exit.cause) } : undefined;
  const message = `Abort handler of task ${invocation.taskId} returned without a terminal outcome`;
  yield* step(state, invocation, () => ({ fault: failure?.error ?? new Error(message) }));
});

export const runReservation = Effect.fn("runReservation")(function* (
  state: SchedulerState,
  reservation: Reservation,
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
