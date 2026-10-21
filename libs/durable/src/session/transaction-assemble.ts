import { Effect } from "effect";

import documentsModule from "../documents.ts";
import util from "../harness/util.ts";
import stepModule from "../step.ts";
import type typesModule from "../types.types.ts";
import transactionPlan from "./transaction-plan.ts";
import transactionState from "./transaction-state.ts";
import transactionTypes from "./transaction-types.ts";
import type transactionTypesModule from "./transaction-types.types.ts";

const { abortChanges, committedTask, currentTask, taskEntry } = transactionState;
const { eachStep, thenStep } = stepModule;
const { scanAll } = util;
const { INTERNAL_SCAN_PAGE_SIZE } = transactionTypes;
const { addressId } = documentsModule;
const { applySubmissionChange, planDocument, publishes, rejectForkSourceWrites } = transactionPlan;

const ownerChecks = (state: transactionTypesModule.TxState) => {
  const owners: { readonly what: string; readonly taskId: typesModule.TaskId }[] = [];
  for (const write of state.writes) {
    if (write.type !== "conversation" || write.value.owner === undefined) continue;
    owners.push({ taskId: write.value.owner.taskId, what: "Conversation owner task" });
  }
  for (const task of state.tasksById.values()) {
    const record = task.write?.kind === "create" ? task.write.record : undefined;
    if (record?.owner !== undefined) owners.push({ taskId: record.owner, what: "Task owner" });
  }
  return owners;
};

type OwnerCheck = { readonly what: string; readonly taskId: typesModule.TaskId };

const checkOwner = (
  { what, taskId }: OwnerCheck,
  task: transactionTypesModule.AnyTaskRecord | undefined,
): void => {
  if (task === undefined) throw new Error(`${what} ${taskId} does not exist`);
  if (task.state.status === "terminal" || task.state.status === "completing") {
    throw new Error(`${what} ${taskId} is ${task.state.status}`);
  }
  if (task.abortRequested) throw new Error(`${what} ${taskId} is abort-marked`);
};

const validateOwners = (state: transactionTypesModule.TxState): Effect.Effect<void> => {
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
  id: typesModule.TaskId,
  record: transactionTypesModule.AnyTaskRecord,
  committed: transactionTypesModule.AnyTaskRecord | undefined,
): void => {
  if (committed === undefined) throw new Error(`Task ${id} does not exist`);
  if (committed.state.status === "terminal") throw new Error(`Task ${id} is already terminal`);
  if (committed.conversationId !== record.conversationId) {
    throw new Error(`Task ${id} cannot change conversations`);
  }
};

const validateReplacements = (state: transactionTypesModule.TxState): Effect.Effect<void> => {
  const replacements: [typesModule.TaskId, transactionTypesModule.AnyTaskRecord][] = [];
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

const terminalTaskIds = (state: transactionTypesModule.TxState): Set<typesModule.TaskId> => {
  const ids = new Set<typesModule.TaskId>();
  for (const task of state.tasksById.values()) {
    if (task.write?.record.state.status === "terminal") ids.add(task.write.record.id);
  }
  return ids;
};

const scanTaskDocuments = (state: transactionTypesModule.TxState, taskId: typesModule.TaskId) =>
  scanAll((cursor) =>
    state.host.storage.scanDocuments(
      { at: "current", scope: { kind: "task", taskId } },
      INTERNAL_SCAN_PAGE_SIZE,
      cursor,
      state.context,
    ),
  );

const retireTerminalTaskDocuments = (
  state: transactionTypesModule.TxState,
): Effect.Effect<void> => {
  const terminal = terminalTaskIds(state);
  return terminal.size === 0 ? Effect.void : retireTaskDocuments(state, terminal);
};

const retireTaskDocuments = Effect.fnUntraced(function* (
  state: transactionTypesModule.TxState,
  terminal: Set<typesModule.TaskId>,
) {
  const plans = state.plans;
  const retiring = new Set<typesModule.DocumentId>();
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

const publicationTasks = (state: transactionTypesModule.TxState): typesModule.TaskId[] => {
  const pending: typesModule.TaskId[] = [];
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

const loadPublications = (state: transactionTypesModule.TxState): Effect.Effect<void> => {
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

const assignPublications = (state: transactionTypesModule.TxState): void => {
  for (const plan of state.plans) {
    if (!publishes(plan)) continue;
    const scope = plan.record.scope;
    if (scope.kind === "conversation") plan.conversationId = scope.conversationId;
    if (scope.kind !== "task") continue;
    plan.conversationId = taskEntry(state, scope.taskId).publicationConversationId;
  }
};

const applySubmissionChanges = (state: transactionTypesModule.TxState): Effect.Effect<void> => {
  if (state.submissionChanges.length === 0) return Effect.void;
  return Effect.forEach(
    state.submissionChanges,
    ({ id, change }) =>
      Effect.map(
        Effect.suspend(() => {
          const known = state.submissions.get(id);
          if (known !== undefined)
            return Effect.succeed<typesModule.SubmissionRecord | undefined>(known);
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

type PlanContent = NonNullable<transactionTypesModule.DocumentPlan["content"]>;

const checkpointContent = (
  plan: transactionTypesModule.DocumentPlan,
  content: PlanContent,
): PlanContent => {
  const change = plan.change;
  if (content.type !== "document.change" || content.content.kind !== "delta") return content;
  if (change?.loaded === undefined) return content;
  const { prepared, version } = change;
  const info = { deltasSinceBase: change.loaded.deltasSinceBase };
  if (change.definition?.checkpointWhen?.(prepared.value, prepared.ops, info) !== true) {
    return content;
  }
  return { ...content, content: { kind: "base", value: prepared.value, version } };
};

const collectWrites = (state: transactionTypesModule.TxState): typesModule.StorageWrite[] => {
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
    if (plan.retire) writes.push({ id: plan.record.id, type: "document.retire" });
  }
  return writes;
};

const assemble = (
  state: transactionTypesModule.TxState,
): Effect.Effect<typesModule.StorageWrite[]> => {
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

const settlePending = (state: transactionTypesModule.TxState) =>
  Effect.promise(() => Promise.allSettled(state.pendingOperations));

const settleFailure = (state: transactionTypesModule.TxState): Effect.Effect<void> =>
  Effect.suspend(() => {
    state.sealed = true;
    abortChanges(state);
    return Effect.asVoid(settlePending(state));
  });

const rejectPending = Effect.fnUntraced(function* (state: transactionTypesModule.TxState) {
  abortChanges(state);
  yield* settlePending(state);
  throw new Error("Session commit callback settled before its pending Tx operations");
});

const settleSuccess = (
  state: transactionTypesModule.TxState,
): Effect.Effect<readonly typesModule.StorageWrite[]> =>
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

const transactionAssemble = {
  settleFailure,
  settleSuccess,
};

export default transactionAssemble;
