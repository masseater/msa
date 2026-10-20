import { Function } from "effect";

import type dualTypes from "../dual.ts";
import type typesModule from "../types.types.ts";
import type transactionTypesModule from "./transaction-types.types.ts";

const applySubmissionChange: dualTypes.Dual2<
  typesModule.SubmissionRecord,
  transactionTypesModule.SubmissionChange,
  typesModule.SubmissionRecord
> = Function.dual(
  2,
  (
    current: typesModule.SubmissionRecord,
    change: transactionTypesModule.SubmissionChange,
  ): typesModule.SubmissionRecord => {
    if (current.status === "done" || current.status === "unanswered") return current;
    if (change.status === "placed") {
      if (current.status !== "queued") throw new Error(`Submission ${current.id} is not queued`);
      const status = current.type === "input" ? "placed" : "done";
      return { ...current, entry: change.entry, status } as typesModule.SubmissionRecord;
    }
    if (change.status === "done" && current.status !== "placed") {
      throw new Error(`Submission ${current.id} is not a placed input`);
    }
    return { ...current, ...change } as typesModule.SubmissionRecord;
  },
);

const loadedContent = (
  document: transactionTypesModule.DocumentEntry,
  target: Extract<transactionTypesModule.DocumentTarget, { readonly kind: "loaded" }>,
) => {
  const loaded = target.document;
  const definition = document.definition!;
  const prepared = document.prepared!;
  const version = definition.version;
  const id = loaded.record.id;
  if (loaded.storedVersion < version) {
    return {
      content: { kind: "base", value: prepared.value, version },
      id,
      type: "document.change",
    } as const;
  }
  if (prepared.ops.length === 0) return undefined;
  return {
    content: { kind: "delta", ops: prepared.ops, version },
    id,
    type: "document.change",
  } as const;
};

const planLoaded = (
  document: transactionTypesModule.DocumentEntry,
  target: Extract<transactionTypesModule.DocumentTarget, { readonly kind: "loaded" }>,
  plan: Pick<transactionTypesModule.DocumentPlan, "addressId" | "retire">,
): transactionTypesModule.DocumentPlan => {
  const loaded = target.document;
  const definition = document.definition!;
  const prepared = document.prepared!;
  const content = loadedContent(document, target);
  const change = {
    definition,
    loaded,
    prepared,
    tracker: loaded.tracker,
    version: definition.version,
  };
  return {
    ...plan,
    change,
    record: loaded.record,
    ...(content === undefined ? {} : { content }),
  };
};

const planDocument = (
  document: transactionTypesModule.DocumentEntry,
): transactionTypesModule.DocumentPlan | undefined => {
  const target = document.target;
  if (target === undefined) return undefined;
  const plan = { addressId: document.addressId, retire: document.retireOnCommit };
  switch (target.kind) {
    case "created": {
      const prepared = document.prepared!;
      const { record, version, tracker } = target;
      const content = { kind: "base", value: prepared.value, version } as const;
      return {
        ...plan,
        change: { prepared, tracker, version },
        content: { content, record, type: "document.create" },
        record,
      };
    }
    case "fork-copy":
      return {
        ...plan,
        content: { record: target.record, source: target.source, type: "document.copy" },
        record: target.record,
      };
    case "retire-only":
      return { ...plan, record: target.record };
    case "loaded":
      return planLoaded(document, target, plan);
  }
};

const publishes = (plan: transactionTypesModule.DocumentPlan): boolean =>
  plan.retire || plan.change?.loaded === undefined || plan.content !== undefined;

const currentForkSource = (
  state: transactionTypesModule.TxState,
  record: transactionTypesModule.DocumentPlan["record"],
): typesModule.ConversationId | undefined => {
  const scope = record.scope;
  if (scope.kind !== "conversation") return undefined;
  if (!state.forkSourceConversationIds.has(scope.conversationId)) return undefined;
  return record.fork === "current" ? scope.conversationId : undefined;
};

const rejectForkSourceWrites = (state: transactionTypesModule.TxState): void => {
  for (const plan of state.plans) {
    if (plan.content === undefined && !plan.retire) continue;
    const record = plan.record;
    if (state.forkSourceDocumentIds.has(record.id)) {
      throw new Error(`Cannot change fork source document ${record.id} in the fork transaction`);
    }
    const conversationId = currentForkSource(state, record);
    if (conversationId !== undefined) {
      throw new Error(
        `Cannot fork conversation ${conversationId} while changing its current-policy documents`,
      );
    }
  }
};

const transactionPlan = {
  applySubmissionChange,
  planDocument,
  publishes,
  rejectForkSourceWrites,
};

export default transactionPlan;
