import type { Context } from "@msa/chord";
import { Effect } from "effect";

import bridge from "./bridge.ts";
import schedulerObserve from "./scheduler-observe.ts";
import schedulerRecords from "./scheduler-records.ts";
import type schedulerStateTypes from "./scheduler-state.types.ts";
import schedulerTypes from "./scheduler-types.ts";
import type schedulerTypesModule from "./scheduler-types.types.ts";
import util from "./util.ts";

const { LIVE_STATUSES, SCAN_PAGE_SIZE } = schedulerTypes;
const { scanAll } = util;
const { withState } = schedulerRecords;
const { observePublication } = schedulerObserve;
const { toPromise } = bridge;

const openIn = Effect.fnUntraced(function* (
  state: schedulerStateTypes.SchedulerState,
  tx: schedulerTypesModule.Transaction,
) {
  const { graph } = state;
  const scans = yield* Effect.forEach(LIVE_STATUSES, (status) =>
    scanAll((cursor) => tx.scanTasks({ status }, SCAN_PAGE_SIZE, cursor)),
  );
  for (const record of scans.flat()) {
    graph.track(undefined, record);
    if (record.abandonOnRestart === true) state.abandoned.add(record.id);
    if (record.state.status === "running") {
      tx.setTask(withState(record, { checkpoint: record.state.checkpoint, status: "pending" }));
    }
    if (record.state.status === "waiting" && record.state.policy === "failFast") {
      graph.failFastChecks.add(record.id);
    }
  }
});

const openScheduler = Effect.fnUntraced(function* (
  state: schedulerStateTypes.SchedulerState,
  context: Context,
) {
  const { session, registry } = state.options;
  session.observeCommits((publication) => observePublication(state, publication));
  session.subscribeClose(() => state.seal());
  state.unsubscribeRegistry = registry.subscribe(() => state.wake.kick());
  const change = yield* toPromise((tx: schedulerTypesModule.Transaction) => openIn(state, tx));
  yield* Effect.promise(() => session.commitWith(change, context));
  state.cascadePending = true;
  state.wake.reconcile();
});

const joinScheduler = Effect.fnUntraced(function* (state: schedulerStateTypes.SchedulerState) {
  const invocations = [...state.invocations.values()];
  for (const invocation of invocations) invocation.controller.abort();
  yield* Effect.promise(() =>
    Promise.allSettled([...state.invocations.values()].map((invocation) => invocation.done)),
  );
});

const schedulerOpen = {
  joinScheduler,
  openScheduler,
};

export default schedulerOpen;
