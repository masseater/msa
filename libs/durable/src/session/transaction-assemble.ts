import { Effect } from "effect";

import { addressId } from "../documents.ts";
import { scanAll } from "../harness/util.ts";
import type { DocumentId, StorageWrite, TaskId } from "../types.ts";
import {
  applySubmissionChange,
  planDocument,
  publishes,
  rejectForkSourceWrites,
} from "./transaction-plan.ts";
import { abortChanges, committedTask, currentTask, taskEntry } from "./transaction-state.ts";
import { type DocumentPlan, INTERNAL_SCAN_PAGE_SIZE, type TxState } from "./transaction-types.ts";

const ownerChecks = (state: TxState) => {
  const owners: { readonly what: string; readonly taskId: TaskId }[] = [];
  for (const write of state.writes) {
    if (write.type !== "conversation" || write.value.owner === undefined) continue;
    owners.push({ what: "Conversation owner task", taskId: write.value.owner.taskId });
  }
  for (const task of state.tasksById.values()) {
    const record = task.write?.kind === "create" ? task.write.record : undefined;
    if (record?.owner !== undefined) owners.push({ what: "Task owner", taskId: record.owner });
  }
  return owners;
};

const validateOwners = Effect.fn("validateOwners")(function* (state: TxState) {
  for (const { what, taskId } of ownerChecks(state)) {
    const task = yield* currentTask(state, taskId);
    if (task === undefined) throw new Error(`${what} ${taskId} does not exist`);
    if (task.state.status === "terminal" || task.state.status === "completing") {
      throw new Error(`${what} ${taskId} is ${task.state.status}`);
    }
    if (task.abortRequested) throw new Error(`${what} ${taskId} is abort-marked`);
  }
});

const validateReplacements = Effect.fn("validateReplacements")(function* (state: TxState) {
  for (const [id, task] of state.tasksById) {
    if (task.write?.kind !== "replace") continue;
    const record = task.write.record;
    const committed = yield* Effect.promise(() => committedTask(state, id));
    if (committed === undefined) throw new Error(`Task ${id} does not exist`);
    if (committed.state.status === "terminal") throw new Error(`Task ${id} is already terminal`);
    if (committed.conversationId !== record.conversationId) {
      throw new Error(`Task ${id} cannot change conversations`);
    }
  }
});

const terminalTaskIds = (state: TxState): Set<TaskId> => {
  const ids = new Set<TaskId>();
  for (const task of state.tasksById.values()) {
    if (task.write?.record.state.status === "terminal") ids.add(task.write.record.id);
  }
  return ids;
};

const scanTaskDocuments = (state: TxState, taskId: TaskId) =>
  scanAll((cursor) =>
    state.host.storage.scanDocuments(
      { scope: { kind: "task", taskId }, at: "current" },
      INTERNAL_SCAN_PAGE_SIZE,
      cursor,
      state.context,
    ),
  );

const retireTerminalTaskDocuments = Effect.fn("retireTerminalTaskDocuments")(function* (
  state: TxState,
) {
  const terminal = terminalTaskIds(state);
  if (terminal.size === 0) return;
  const plans = state.plans;
  const retiring = new Set<DocumentId>();
  for (const plan of plans) {
    const scope = plan.record.scope;
    if (scope.kind !== "task" || !terminal.has(scope.taskId)) continue;
    plan.retire = true;
    retiring.add(plan.record.id);
  }
  for (const taskId of terminal) {
    if (state.tasksById.get(taskId)?.write?.kind === "create") continue;
    const records = yield* scanTaskDocuments(state, taskId);
    for (const record of records) {
      if (retiring.has(record.id)) continue;
      plans.push({ addressId: addressId(record), record, retire: true });
      retiring.add(record.id);
    }
  }
});

const assignPublications = Effect.fn("assignPublications")(function* (state: TxState) {
  for (const plan of state.plans) {
    if (!publishes(plan)) continue;
    const scope = plan.record.scope;
    if (scope.kind === "conversation") plan.conversationId = scope.conversationId;
    if (scope.kind !== "task") continue;
    const task = taskEntry(state, scope.taskId);
    if (task.publicationConversationId === undefined) {
      const current = yield* currentTask(state, scope.taskId);
      if (current !== undefined) task.publicationConversationId = current.conversationId;
    }
    plan.conversationId = task.publicationConversationId;
  }
});

const applySubmissionChanges = Effect.fn("applySubmissionChanges")(function* (state: TxState) {
  for (const { id, change } of state.submissionChanges) {
    const current =
      state.submissions.get(id) ??
      (yield* Effect.promise(() => state.host.storage.submission(id, state.context)));
    if (current === undefined) throw new Error(`Submission ${id} does not exist`);
    const next = applySubmissionChange(current, change);
    if (next !== current) state.submissions.set(id, next);
  }
});

type PlanContent = NonNullable<DocumentPlan["content"]>;

const checkpointContent = (plan: DocumentPlan, content: PlanContent): PlanContent => {
  const change = plan.change;
  if (content.type !== "document.change" || content.content.kind !== "delta") return content;
  if (change?.loaded === undefined) return content;
  const { prepared, version } = change;
  const info = { deltasSinceBase: change.loaded.deltasSinceBase };
  if (change.definition?.checkpointWhen?.(prepared.value, prepared.ops, info) !== true) {
    return content;
  }
  return { ...content, content: { version, kind: "base", value: prepared.value } };
};

const collectWrites = (state: TxState): StorageWrite[] => {
  const writes = state.writes;
  for (const value of state.submissions.values()) writes.push({ type: "submission", value });
  for (const task of state.tasksById.values()) {
    if (task.write !== undefined) writes.push({ type: "task", value: task.write.record });
  }
  for (const plan of state.plans) {
    if (plan.content !== undefined) {
      plan.content = checkpointContent(plan, plan.content);
      writes.push(plan.content);
    }
    if (plan.retire) writes.push({ type: "document.retire", id: plan.record.id });
  }
  return writes;
};

const assemble = Effect.fn("assemble")(function* (state: TxState) {
  for (const document of state.documents) {
    const plan = planDocument(document);
    if (plan !== undefined) state.plans.push(plan);
  }
  rejectForkSourceWrites(state);
  yield* validateOwners(state);
  yield* validateReplacements(state);
  yield* retireTerminalTaskDocuments(state);
  yield* assignPublications(state);
  yield* applySubmissionChanges(state);
  return collectWrites(state);
});

const settlePending = (state: TxState) =>
  Effect.promise(() => Promise.allSettled(state.pendingOperations));

export const settleFailure = (state: TxState): Effect.Effect<void> =>
  Effect.suspend(() => {
    state.sealed = true;
    abortChanges(state);
    return Effect.asVoid(settlePending(state));
  });

export const settleSuccess = Effect.fn("settleSuccess")(function* (state: TxState) {
  state.sealed = true;
  if (state.pendingOperations.size > 0) {
    abortChanges(state);
    yield* settlePending(state);
    throw new Error("Session commit callback settled before its pending Tx operations");
  }
  return yield* Effect.suspend(() => {
    for (const document of state.documents) {
      if (document.change !== undefined) document.prepared = document.change.prepare();
    }
    return assemble(state);
  }).pipe(Effect.onError(() => Effect.sync(() => abortChanges(state))));
});
