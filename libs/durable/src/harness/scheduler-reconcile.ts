import { Cause, Effect, Exit } from "effect";

import { eachStep, settleStep, thenStep } from "../step.ts";
import { finalize } from "./scheduler-finalize.ts";
import { anyFailed, loadPending, loadScopes } from "./scheduler-load.ts";
import { failedOutcome, withAbortMark } from "./scheduler-records.ts";
import type { SchedulerState } from "./scheduler-state.ts";
import type { AnyTaskRecord, ConversationId, TaskId, Transaction } from "./scheduler-types.ts";

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

const markFailed = (state: SchedulerState, marks: Marks, on: readonly TaskId[]): void => {
  for (const member of on) {
    const record = state.graph.live.get(member);
    if (record !== undefined && !failedOutcome(record)) markIn(marks, record, undefined);
  }
};

const markFailFast = (
  state: SchedulerState,
  marks: Marks,
  checks: readonly TaskId[],
): Effect.Effect<void> =>
  eachStep(checks, (id: TaskId) => {
    const waiter = state.graph.live.get(id);
    if (waiter?.state.status !== "waiting") return Effect.void;
    const on = waiter.state.on;
    return Effect.map(anyFailed(state, on), (failed) => {
      if (failed) markFailed(state, marks, on);
    });
  });

const withdrawCancelled = (
  state: SchedulerState,
  tx: Transaction,
  queued: readonly ConversationId[],
): Effect.Effect<void> =>
  eachStep(queued, (id: ConversationId) =>
    state.graph.belowCancelled({ conversation: id })
      ? Effect.promise(() => state.options.withdrawInputs(tx, id))
      : Effect.void,
  );

const reconcileIn = (
  state: SchedulerState,
  tx: Transaction,
  cascade: boolean,
  checks: readonly TaskId[],
): void | Promise<void> => {
  if (state.closing) return undefined;
  const marks: Marks = new Map();
  let queued: readonly ConversationId[] = [];
  const scopes = cascade
    ? Effect.map(loadScopes(state, true), (loaded) => {
        queued = loaded;
      })
    : loadPending(state);
  const pending = thenStep(scopes, () => {
    markIntent(state, marks);
    return thenStep(markFailFast(state, marks, checks), () => {
      for (const { record, reason } of marks.values()) tx.setTask(withAbortMark(record, reason));
      return thenStep(withdrawCancelled(state, tx, queued), () => finalize(state, tx));
    });
  });
  return settleStep(pending, () => undefined);
};

export const reconcile = Effect.fnUntraced(function* (state: SchedulerState) {
  state.reconcileScheduled = false;
  const cascade = state.cascadePending;
  state.cascadePending = false;
  const checks = [...state.graph.failFastChecks];
  state.graph.failFastChecks.clear();
  const exit = yield* Effect.exit(
    Effect.promise(() =>
      state.options.session.commitWith(
        (tx: Transaction) => reconcileIn(state, tx, cascade, checks),
        state.options.context,
      ),
    ),
  );
  if (Exit.isFailure(exit)) state.failSession(Cause.squash(exit.cause));
  state.settleIdle();
});

export const scheduleReconcile = (state: SchedulerState): void => {
  if (state.reconcileScheduled || state.closing) return;
  state.reconcileScheduled = true;
  queueMicrotask(() => void Effect.runPromise(reconcile(state)));
};
