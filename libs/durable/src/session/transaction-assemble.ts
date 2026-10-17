import { Effect } from "effect";

import { addressId } from "../documents.ts";
import { scanAll } from "../harness/util.ts";
import { eachStep, thenStep } from "../step.ts";
import type { DocumentId, StorageWrite, SubmissionRecord, TaskId } from "../types.ts";
import {
  applySubmissionChange,
  planDocument,
  publishes,
  rejectForkSourceWrites,
} from "./transaction-plan.ts";
import { abortChanges, committedTask, currentTask, taskEntry } from "./transaction-state.ts";
import {
  type AnyTaskRecord,
  type DocumentPlan,
  INTERNAL_SCAN_PAGE_SIZE,
  type TxState,
} from "./transaction-types.ts";

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

type OwnerCheck = { readonly what: string; readonly taskId: TaskId };

const checkOwner = ({ what, taskId }: OwnerCheck, task: AnyTaskRecord | undefined): void => {
  if (task === undefined) throw new Error(`${what} ${taskId} does not exist`);
  if (task.state.status === "terminal" || task.state.status === "completing") {
    throw new Error(`${what} ${taskId} is ${task.state.status}`);
  }
  if (task.abortRequested) throw new Error(`${what} ${taskId} is abort-marked`);
};

const validateOwners = (state: TxState): Effect.Effect<void> => {
  const checks = ownerChecks(state);
  let at = 0;
  for (; at < checks.length; at++) {
    const staged = state.tasksById.get(checks[at]!.taskId)?.write?.record;
    if (staged === undefined) break;
    checkOwner(checks[at]!, staged);
  }
  if (at === checks.length) return Effect.void;
  return Effect.forEach(
    checks.slice(at),
    (check) => Effect.map(currentTask(state, check.taskId), (task) => checkOwner(check, task)),
    { discard: true },
  );
};

const checkReplacement = (
  id: TaskId,
  record: AnyTaskRecord,
  committed: AnyTaskRecord | undefined,
): void => {
  if (committed === undefined) throw new Error(`Task ${id} does not exist`);
  if (committed.state.status === "terminal") throw new Error(`Task ${id} is already terminal`);
  if (committed.conversationId !== record.conversationId) {
    throw new Error(`Task ${id} cannot change conversations`);
  }
};

const validateReplacements = (state: TxState): Effect.Effect<void> => {
  const replacements: [TaskId, AnyTaskRecord][] = [];
  for (const [id, task] of state.tasksById) {
    if (task.write?.kind === "replace") replacements.push([id, task.write.record]);
  }
  return eachStep(replacements, ([id, record]) =>
    Effect.map(
      Effect.promise(() => committedTask(state, id)),
      (committed) => checkReplacement(id, record, committed),
    ),
  );
};

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

const retireTerminalTaskDocuments = (state: TxState): Effect.Effect<void> => {
  const terminal = terminalTaskIds(state);
  return terminal.size === 0 ? Effect.void : retireTaskDocuments(state, terminal);
};

const retireTaskDocuments = Effect.fnUntraced(function* (state: TxState, terminal: Set<TaskId>) {
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

const publicationTasks = (state: TxState): TaskId[] => {
  const pending: TaskId[] = [];
  for (const plan of state.plans) {
    if (!publishes(plan)) continue;
    const scope = plan.record.scope;
    if (
      scope.kind === "task" &&
      taskEntry(state, scope.taskId).publicationConversationId === undefined
    )
      pending.push(scope.taskId);
  }
  return pending;
};

const loadPublications = (state: TxState): Effect.Effect<void> => {
  const pending = publicationTasks(state);
  if (pending.length === 0) return Effect.void;
  return Effect.forEach(
    pending,
    (taskId) =>
      Effect.suspend(() => {
        const task = taskEntry(state, taskId);
        if (task.publicationConversationId !== undefined) return Effect.void;
        return Effect.map(currentTask(state, taskId), (current) => {
          if (current !== undefined) task.publicationConversationId = current.conversationId;
        });
      }),
    { discard: true },
  );
};

const assignPublications = (state: TxState): void => {
  for (const plan of state.plans) {
    if (!publishes(plan)) continue;
    const scope = plan.record.scope;
    if (scope.kind === "conversation") plan.conversationId = scope.conversationId;
    if (scope.kind !== "task") continue;
    plan.conversationId = taskEntry(state, scope.taskId).publicationConversationId;
  }
};

const applySubmissionChanges = (state: TxState): Effect.Effect<void> => {
  if (state.submissionChanges.length === 0) return Effect.void;
  return Effect.forEach(
    state.submissionChanges,
    ({ id, change }) =>
      Effect.map(
        Effect.suspend(() => {
          const known = state.submissions.get(id);
          if (known !== undefined) return Effect.succeed<SubmissionRecord | undefined>(known);
          return Effect.promise(() => state.host.storage.submission(id, state.context));
        }),
        (current) => {
          if (current === undefined) throw new Error(`Submission ${id} does not exist`);
          const next = applySubmissionChange(current, change);
          if (next !== current) state.submissions.set(id, next);
        },
      ),
    { discard: true },
  );
};

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

const assemble = (state: TxState): Effect.Effect<StorageWrite[]> => {
  for (const document of state.documents) {
    const plan = planDocument(document);
    if (plan !== undefined) state.plans.push(plan);
  }
  rejectForkSourceWrites(state);
  return thenStep(validateOwners(state), () =>
    thenStep(validateReplacements(state), () =>
      thenStep(retireTerminalTaskDocuments(state), () =>
        thenStep(loadPublications(state), () => {
          assignPublications(state);
          return thenStep(applySubmissionChanges(state), () =>
            Effect.succeed(collectWrites(state)),
          );
        }),
      ),
    ),
  );
};

const settlePending = (state: TxState) =>
  Effect.promise(() => Promise.allSettled(state.pendingOperations));

export const settleFailure = (state: TxState): Effect.Effect<void> =>
  Effect.suspend(() => {
    state.sealed = true;
    abortChanges(state);
    return Effect.asVoid(settlePending(state));
  });

const rejectPending = Effect.fnUntraced(function* (state: TxState) {
  abortChanges(state);
  yield* settlePending(state);
  throw new Error("Session commit callback settled before its pending Tx operations");
});

export const settleSuccess = (state: TxState): Effect.Effect<readonly StorageWrite[]> =>
  Effect.suspend(() => {
    state.sealed = true;
    if (state.pendingOperations.size > 0) return rejectPending(state);
    const assembled = Effect.suspend(() => {
      for (const document of state.documents) {
        if (document.change !== undefined) document.prepared = document.change.prepare();
      }
      return assemble(state);
    });
    return Effect.onError(assembled, () => Effect.sync(() => abortChanges(state)));
  });
