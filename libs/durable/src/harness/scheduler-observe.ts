import type { JsonValue } from "@msa/chord";
import { Function } from "effect";

import {
  cancellationIntent,
  conversationNode,
  failedOutcome,
  parentOf,
} from "./scheduler-records.ts";
import type { SchedulerState } from "./scheduler-state.ts";
import type {
  AnyTaskRecord,
  CommitPublication,
  Dual2,
  SettledTask,
  TaskId,
} from "./scheduler-types.ts";

type Changes = CommitPublication["changes"];

const observeConversations = (state: SchedulerState, changes: Changes): void => {
  for (const change of changes) {
    if (change.type === "conversation" && !state.graph.edges.has(change.value.id)) {
      state.graph.setEdge(change.value.id, change.value.owner?.taskId ?? null);
    }
  }
};

const observeStatus = (
  state: SchedulerState,
  previous: AnyTaskRecord | undefined,
  record: AnyTaskRecord,
): void => {
  const status = record.state.status;
  if (status === "completing" && previous?.state.status !== "completing") {
    if (cancellationIntent(record)) state.cascadePending = true;
    state.wake.reconcile();
  }
  if (
    status === "waiting" &&
    record.state.policy === "failFast" &&
    previous?.state.status !== "waiting"
  ) {
    state.graph.failFastChecks.add(record.id);
    state.wake.reconcile();
  }
};

const observeTask = (
  state: SchedulerState,
  record: AnyTaskRecord,
  found: { readonly updated: AnyTaskRecord[]; readonly failed: TaskId[] },
): void => {
  const { graph } = state;
  const previous = graph.live.get(record.id);
  if (failedOutcome(record) && (previous === undefined || !failedOutcome(previous)))
    found.failed.push(record.id);
  graph.track(previous, record);
  if (record.state.status === "terminal") {
    state.failedMigrations.delete(record.id);
    graph.failFastChecks.delete(record.id);
    state.taskWaiters.resolve(record.id, record as SettledTask<JsonValue>);
    state.wake.reconcile();
    return;
  }
  if (record.abortRequested && previous?.abortRequested !== true) {
    state.cascadePending = true;
    const invocation = state.invocations.get(record.id);
    if (invocation?.mode === "run") invocation.controller.abort();
  }
  if (previous?.abortReason !== undefined && record.abortReason === undefined)
    state.cascadePending = true;
  observeStatus(state, previous, record);
  if (previous === undefined) found.updated.push(record);
};

const observeFailed = (state: SchedulerState, failed: readonly TaskId[]): void => {
  const { graph } = state;
  for (const id of failed) {
    for (const waiter of graph.waiters.get(id) ?? []) {
      const waiting = graph.live.get(waiter)?.state;
      if (waiting?.status === "waiting" && waiting.policy === "failFast") {
        graph.failFastChecks.add(waiter);
        state.wake.reconcile();
      }
    }
  }
};

const observeSubmissions = (state: SchedulerState, changes: Changes): void => {
  const { graph } = state;
  for (const change of changes) {
    if (
      change.type !== "submission" ||
      change.value.status !== "queued" ||
      change.value.type !== "input"
    )
      continue;
    if (graph.intent.size === 0) continue;
    const conversation = change.value.conversationId;
    if (!graph.known(conversationNode(conversation)) || graph.belowCancelled({ conversation })) {
      state.cascadePending = true;
    }
  }
};

const observeUpdated = (state: SchedulerState, updated: readonly AnyTaskRecord[]): void => {
  const { graph } = state;
  for (const record of updated) {
    if (graph.unloaded.has(record.id)) state.wake.reconcile();
    else if (!record.background && !record.abortRequested && graph.belowCancelled(parentOf(record)))
      state.cascadePending = true;
  }
};

export const observePublication: Dual2<SchedulerState, CommitPublication, void> = Function.dual(
  2,
  (state: SchedulerState, publication: CommitPublication): void => {
    const found = { updated: [] as AnyTaskRecord[], failed: [] as TaskId[] };
    let changed = false;
    observeConversations(state, publication.changes);
    for (const change of publication.changes) {
      if (change.type !== "task") continue;
      changed = true;
      observeTask(state, change.value, found);
    }
    observeFailed(state, found.failed);
    observeSubmissions(state, publication.changes);
    observeUpdated(state, found.updated);
    if (state.cascadePending) state.wake.reconcile();
    state.graph.sweep();
    if (!changed) return;
    state.settleIdle();
    state.wake.kick();
  },
);
