import { Function } from "effect";

import type { Dual2 } from "../dual.ts";
import type { ConversationId, SubmissionRecord } from "../types.ts";
import type {
  DocumentEntry,
  DocumentPlan,
  DocumentTarget,
  SubmissionChange,
  TxState,
} from "./transaction-types.ts";

export const applySubmissionChange: Dual2<SubmissionRecord, SubmissionChange, SubmissionRecord> =
  Function.dual(2, (current: SubmissionRecord, change: SubmissionChange): SubmissionRecord => {
    if (current.status === "done" || current.status === "unanswered") return current;
    if (change.status === "placed") {
      if (current.status !== "queued") throw new Error(`Submission ${current.id} is not queued`);
      const status = current.type === "input" ? "placed" : "done";
      return { ...current, status, entry: change.entry } as SubmissionRecord;
    }
    if (change.status === "done" && current.status !== "placed") {
      throw new Error(`Submission ${current.id} is not a placed input`);
    }
    return { ...current, ...change } as SubmissionRecord;
  });

const loadedContent = (
  document: DocumentEntry,
  target: Extract<DocumentTarget, { readonly kind: "loaded" }>,
) => {
  const loaded = target.document;
  const definition = document.definition!;
  const prepared = document.prepared!;
  const version = definition.version;
  const id = loaded.record.id;
  if (loaded.storedVersion < version) {
    return {
      type: "document.change",
      id,
      content: { version, kind: "base", value: prepared.value },
    } as const;
  }
  if (prepared.ops.length === 0) return undefined;
  return {
    type: "document.change",
    id,
    content: { version, kind: "delta", ops: prepared.ops },
  } as const;
};

const planLoaded = (
  document: DocumentEntry,
  target: Extract<DocumentTarget, { readonly kind: "loaded" }>,
  plan: Pick<DocumentPlan, "addressId" | "retire">,
): DocumentPlan => {
  const loaded = target.document;
  const definition = document.definition!;
  const prepared = document.prepared!;
  const content = loadedContent(document, target);
  const change = {
    tracker: loaded.tracker,
    prepared,
    version: definition.version,
    loaded,
    definition,
  };
  return {
    ...plan,
    record: loaded.record,
    change,
    ...(content === undefined ? {} : { content }),
  };
};

export const planDocument = (document: DocumentEntry): DocumentPlan | undefined => {
  const target = document.target;
  if (target === undefined) return undefined;
  const plan = { addressId: document.addressId, retire: document.retireOnCommit };
  switch (target.kind) {
    case "created": {
      const prepared = document.prepared!;
      const { record, version, tracker } = target;
      const content = { version, kind: "base", value: prepared.value } as const;
      return {
        ...plan,
        record,
        content: { type: "document.create", record, content },
        change: { tracker, prepared, version },
      };
    }
    case "fork-copy":
      return {
        ...plan,
        record: target.record,
        content: { type: "document.copy", record: target.record, source: target.source },
      };
    case "retire-only":
      return { ...plan, record: target.record };
    case "loaded":
      return planLoaded(document, target, plan);
  }
};

export const publishes = (plan: DocumentPlan): boolean =>
  plan.retire || plan.change?.loaded === undefined || plan.content !== undefined;

const currentForkSource = (
  state: TxState,
  record: DocumentPlan["record"],
): ConversationId | undefined => {
  const scope = record.scope;
  if (scope.kind !== "conversation") return undefined;
  if (!state.forkSourceConversationIds.has(scope.conversationId)) return undefined;
  return record.fork === "current" ? scope.conversationId : undefined;
};

export const rejectForkSourceWrites = (state: TxState): void => {
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
