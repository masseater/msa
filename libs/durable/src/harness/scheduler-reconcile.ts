import { Cause, Effect, Exit } from "effect";

import { toPromise } from "./bridge.ts";
import { finalize } from "./scheduler-finalize.ts";
import { anyFailed, loadScopes } from "./scheduler-load.ts";
import { failedOutcome, withAbortMark } from "./scheduler-records.ts";
import type { SchedulerState } from "./scheduler-state.ts";
import type { AnyTaskRecord, TaskId, Transaction } from "./scheduler-types.ts";

type Marks = Map<
  TaskId,
  { readonly record: AnyTaskRecord; readonly reason: "restart" | undefined }
>;

const markIn = (marks: Marks, record: AnyTaskRecord, reason: "restart" | undefined): void => {
  const staged = marks.get(record.id);
  if (staged !== undefined && staged.reason === undefined) return;
  if (record.abortRequested && (record.abortReason === undefined || reason !== undefined)) return;
  marks.set(record.id, { record, reason });
};

const markIntent = (state: SchedulerState, marks: Marks): void => {
  const { graph } = state;
  for (const id of graph.intent) {
    const owner = graph.live.get(id)!;
    const restart = owner.abortReason === "restart" && !failedOutcome(owner);
    for (const { node, live } of graph.walkDown(id, {
      enter: (below) => !graph.intent.has(below),
    })) {
      if (live !== undefined && !node.background)
        markIn(marks, live, restart ? "restart" : undefined);
    }
  }
};

const markFailFast = Effect.fn("markFailFast")(function* (
  state: SchedulerState,
  marks: Marks,
  checks: readonly TaskId[],
) {
  const { graph } = state;
  for (const id of checks) {
    const waiter = graph.live.get(id);
    if (waiter?.state.status !== "waiting") continue;
    if (!(yield* anyFailed(state, waiter.state.on))) continue;
    for (const member of waiter.state.on) {
      const record = graph.live.get(member);
      if (record !== undefined && !failedOutcome(record)) markIn(marks, record, undefined);
    }
  }
});

const reconcileIn = Effect.fn("reconcileIn")(function* (
  state: SchedulerState,
  tx: Transaction,
  cascade: boolean,
  checks: readonly TaskId[],
) {
  if (state.closing) return;
  const queued = yield* loadScopes(state, cascade);
  const marks: Marks = new Map();
  markIntent(state, marks);
  yield* markFailFast(state, marks, checks);
  for (const { record, reason } of marks.values()) tx.setTask(withAbortMark(record, reason));
  for (const id of queued) {
    if (state.graph.belowCancelled({ conversation: id }))
      yield* Effect.promise(() => state.options.withdrawInputs(tx, id));
  }
  yield* finalize(state, tx);
});

export const reconcile = Effect.fn("reconcile")(function* (state: SchedulerState) {
  state.reconcileScheduled = false;
  const cascade = state.cascadePending;
  state.cascadePending = false;
  const checks = [...state.graph.failFastChecks];
  state.graph.failFastChecks.clear();
  const change = yield* toPromise((tx: Transaction) => reconcileIn(state, tx, cascade, checks));
  const exit = yield* Effect.exit(
    Effect.promise(() => state.options.session.commitWith(change, state.options.context)),
  );
  if (Exit.isFailure(exit)) state.failSession(Cause.squash(exit.cause));
  state.settleIdle();
});

export const scheduleReconcile = (state: SchedulerState): void => {
  if (state.reconcileScheduled || state.closing) return;
  state.reconcileScheduled = true;
  queueMicrotask(() => void Effect.runPromise(reconcile(state)));
};
