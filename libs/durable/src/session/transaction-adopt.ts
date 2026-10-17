import { Function } from "effect";

import type { Dual2 } from "../dual.ts";
import type { DocumentCommitChange, DocumentRecord, Seq } from "../types.ts";
import { publishes } from "./transaction-plan.ts";
import { type DocumentPlan, EMPTY_OPERATIONS, type TxState } from "./transaction-types.ts";

type PlanChange = NonNullable<DocumentPlan["change"]>;

const committedRecord = (plan: DocumentPlan, seq: Seq): DocumentRecord => {
  const record: DocumentRecord =
    "createdAt" in plan.record ? plan.record : { ...plan.record, createdAt: seq };
  return plan.retire ? { ...record, retiredAt: seq } : record;
};

const adoptLoaded = (plan: DocumentPlan, change: PlanChange): void => {
  const { loaded, version } = change;
  if (loaded === undefined) return;
  if (loaded.storedVersion < version) loaded.storedVersion = version;
  if (plan.content?.type !== "document.change") return;
  if (plan.content.content.kind === "base") loaded.deltasSinceBase = 0;
  else loaded.deltasSinceBase++;
};

const adoptChange = (
  state: TxState,
  plan: DocumentPlan,
  change: PlanChange,
  record: DocumentRecord,
): void => {
  const { tracker, prepared, loaded, version } = change;
  if (loaded === undefined ? !plan.retire : prepared.ops.length > 0) tracker.adopt(prepared);
  else prepared.abort();
  if (loaded !== undefined) {
    adoptLoaded(plan, change);
    return;
  }
  if (plan.retire) return;
  state.host.install({
    addressId: plan.addressId,
    record,
    storedVersion: version,
    valueVersion: version,
    deltasSinceBase: 0,
    tracker,
  });
};

const publication = (
  state: TxState,
  plan: DocumentPlan,
  record: DocumentRecord,
): DocumentCommitChange | undefined => {
  const conversationId = plan.conversationId;
  const change = plan.change;
  if (plan.retire) {
    if ("createdAt" in plan.record) state.host.evict(plan.addressId, record.id);
    const retired = { version: undefined, value: null, ops: EMPTY_OPERATIONS };
    return { type: "document", record, conversationId, ...retired };
  }
  if (plan.content?.type === "document.copy") {
    return {
      type: "document.copy",
      record,
      conversationId: conversationId!,
      source: plan.content.source,
    };
  }
  if (change === undefined || !publishes(plan)) return undefined;
  return {
    type: "document",
    record,
    conversationId,
    version: change.version,
    value: change.prepared.value,
    ops: change.loaded === undefined ? EMPTY_OPERATIONS : change.prepared.ops,
  };
};

export const adoptPlans: Dual2<TxState, Seq, DocumentCommitChange[]> = Function.dual(
  2,
  (state: TxState, seq: Seq): DocumentCommitChange[] => {
    const publications: DocumentCommitChange[] = [];
    for (const plan of state.plans) {
      const record = committedRecord(plan, seq);
      if (plan.change !== undefined) adoptChange(state, plan, plan.change, record);
      const published = publication(state, plan, record);
      if (published !== undefined) publications.push(published);
    }
    return publications;
  },
);
