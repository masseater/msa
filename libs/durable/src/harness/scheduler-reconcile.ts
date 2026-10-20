import { Cause, Effect, Exit } from "effect";

import stepModule from "../step.ts";
import schedulerFinalize from "./scheduler-finalize.ts";
import schedulerLoad from "./scheduler-load.ts";
import schedulerRecords from "./scheduler-records.ts";
import type schedulerStateTypes from "./scheduler-state.types.ts";
import type schedulerTypesModule from "./scheduler-types.types.ts";

const { failedOutcome, withAbortMark } = schedulerRecords;
const { eachStep, settleStep, thenStep } = stepModule;
const { anyFailed, loadPending, loadScopes } = schedulerLoad;
const { finalize } = schedulerFinalize;

type Marks = Map<
  schedulerTypesModule.TaskId,
  { readonly record: schedulerTypesModule.AnyTaskRecord; readonly reason: "restart" | undefined }
>;

const markIn = (
  marks: Marks,
  record: schedulerTypesModule.AnyTaskRecord,
  reason: "restart" | undefined,
): void => {
  const staged = marks.get(record.id);
  if (staged !== undefined && staged.reason === undefined) return;
  if (record.abortRequested && (record.abortReason === undefined || reason !== undefined)) return;
  marks.set(record.id, { reason, record });
};

const markIntent = (state: schedulerStateTypes.SchedulerState, marks: Marks): void => {
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

const markFailed = (
  state: schedulerStateTypes.SchedulerState,
  marks: Marks,
  on: readonly schedulerTypesModule.TaskId[],
): void => {
  for (const member of on) {
    const record = state.graph.live.get(member);
    if (record !== undefined && !failedOutcome(record)) markIn(marks, record, undefined);
  }
};

const markFailFast = (
  state: schedulerStateTypes.SchedulerState,
  marks: Marks,
  checks: readonly schedulerTypesModule.TaskId[],
): Effect.Effect<void> =>
  eachStep(checks, (id: schedulerTypesModule.TaskId) => {
    const waiter = state.graph.live.get(id);
    if (waiter?.state.status !== "waiting") return Effect.void;
    const on = waiter.state.on;
    return Effect.map(anyFailed(state, on), (failed) => {
      if (failed) markFailed(state, marks, on);
    });
  });

const withdrawCancelled = (
  state: schedulerStateTypes.SchedulerState,
  tx: schedulerTypesModule.Transaction,
  queued: readonly schedulerTypesModule.ConversationId[],
): Effect.Effect<void> =>
  eachStep(queued, (id: schedulerTypesModule.ConversationId) =>
    state.graph.belowCancelled({ conversation: id })
      ? Effect.promise(() => state.options.withdrawInputs(tx, id))
      : Effect.void,
  );

const reconcileIn = (
  state: schedulerStateTypes.SchedulerState,
  tx: schedulerTypesModule.Transaction,
  cascade: boolean,
  checks: readonly schedulerTypesModule.TaskId[],
): void | Promise<void> => {
  if (state.closing) return undefined;
  const marks: Marks = new Map();
  let queued: readonly schedulerTypesModule.ConversationId[] = [];
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

const reconcile = Effect.fnUntraced(function* (state: schedulerStateTypes.SchedulerState) {
  state.reconcileScheduled = false;
  const cascade = state.cascadePending;
  state.cascadePending = false;
  const checks = [...state.graph.failFastChecks];
  state.graph.failFastChecks.clear();
  const exit = yield* Effect.exit(
    Effect.promise(() =>
      state.options.session.commitWith(
        (tx: schedulerTypesModule.Transaction) => reconcileIn(state, tx, cascade, checks),
        state.options.context,
      ),
    ),
  );
  if (Exit.isFailure(exit)) state.failSession(Cause.squash(exit.cause));
  state.settleIdle();
});

const scheduleReconcile = (state: schedulerStateTypes.SchedulerState): void => {
  if (state.reconcileScheduled || state.closing) return;
  state.reconcileScheduled = true;
  queueMicrotask(() => void Effect.runPromise(reconcile(state)));
};

const schedulerReconcile = {
  reconcile,
  scheduleReconcile,
};

export default schedulerReconcile;
