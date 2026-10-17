import type { Context } from "@msa/chord";
import { Effect } from "effect";

import { toPromise } from "./bridge.ts";
import { observePublication } from "./scheduler-observe.ts";
import { withState } from "./scheduler-records.ts";
import type { SchedulerState } from "./scheduler-state.ts";
import { LIVE_STATUSES, SCAN_PAGE_SIZE, type Transaction } from "./scheduler-types.ts";
import { scanAll } from "./util.ts";

const openIn = Effect.fnUntraced(function* (state: SchedulerState, tx: Transaction) {
  const { graph } = state;
  const scans = yield* Effect.forEach(LIVE_STATUSES, (status) =>
    scanAll((cursor) => tx.scanTasks({ status }, SCAN_PAGE_SIZE, cursor)),
  );
  for (const record of scans.flat()) {
    graph.track(undefined, record);
    if (record.abandonOnRestart === true) state.abandoned.add(record.id);
    if (record.state.status === "running") {
      tx.setTask(withState(record, { status: "pending", checkpoint: record.state.checkpoint }));
    }
    if (record.state.status === "waiting" && record.state.policy === "failFast") {
      graph.failFastChecks.add(record.id);
    }
  }
});

export const openScheduler = Effect.fnUntraced(function* (state: SchedulerState, context: Context) {
  const { session, registry } = state.options;
  session.observeCommits((publication) => observePublication(state, publication));
  session.subscribeClose(() => state.seal());
  state.unsubscribeRegistry = registry.subscribe(() => state.wake.kick());
  const change = yield* toPromise((tx: Transaction) => openIn(state, tx));
  yield* Effect.promise(() => session.commitWith(change, context));
  state.cascadePending = true;
  state.wake.reconcile();
});

export const joinScheduler = Effect.fnUntraced(function* (state: SchedulerState) {
  const invocations = [...state.invocations.values()];
  for (const invocation of invocations) invocation.controller.abort();
  yield* Effect.promise(() =>
    Promise.allSettled([...state.invocations.values()].map((invocation) => invocation.done)),
  );
});
