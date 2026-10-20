import { Function } from "effect";

import type dualTypes from "../dual.ts";
import type typesModule from "../types.types.ts";
import transactionPlan from "./transaction-plan.ts";
import transactionTypes from "./transaction-types.ts";
import type transactionTypesModule from "./transaction-types.types.ts";

const { EMPTY_OPERATIONS } = transactionTypes;
const { publishes } = transactionPlan;

type PlanChange = NonNullable<transactionTypesModule.DocumentPlan["change"]>;

const committedRecord = (
  plan: transactionTypesModule.DocumentPlan,
  seq: typesModule.Seq,
): typesModule.DocumentRecord => {
  const record: typesModule.DocumentRecord =
    "createdAt" in plan.record ? plan.record : { ...plan.record, createdAt: seq };
  return plan.retire ? { ...record, retiredAt: seq } : record;
};

const adoptLoaded = (plan: transactionTypesModule.DocumentPlan, change: PlanChange): void => {
  const { loaded, version } = change;
  if (loaded === undefined) return;
  if (loaded.storedVersion < version) loaded.storedVersion = version;
  if (plan.content?.type !== "document.change") return;
  if (plan.content.content.kind === "base") loaded.deltasSinceBase = 0;
  else loaded.deltasSinceBase++;
};

const adoptChange = (
  state: transactionTypesModule.TxState,
  plan: transactionTypesModule.DocumentPlan,
  change: PlanChange,
  record: typesModule.DocumentRecord,
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
    deltasSinceBase: 0,
    record,
    storedVersion: version,
    tracker,
    valueVersion: version,
  });
};

const publication = (
  state: transactionTypesModule.TxState,
  plan: transactionTypesModule.DocumentPlan,
  record: typesModule.DocumentRecord,
): typesModule.DocumentCommitChange | undefined => {
  const conversationId = plan.conversationId;
  const change = plan.change;
  if (plan.retire) {
    if ("createdAt" in plan.record) state.host.evict(plan.addressId, record.id);
    const retired = { ops: EMPTY_OPERATIONS, value: null, version: undefined };
    return { conversationId, record, type: "document", ...retired };
  }
  if (plan.content?.type === "document.copy") {
    return {
      conversationId: conversationId!,
      record,
      source: plan.content.source,
      type: "document.copy",
    };
  }
  if (change === undefined || !publishes(plan)) return undefined;
  return {
    conversationId,
    ops: change.loaded === undefined ? EMPTY_OPERATIONS : change.prepared.ops,
    record,
    type: "document",
    value: change.prepared.value,
    version: change.version,
  };
};

const adoptPlans: dualTypes.Dual2<
  transactionTypesModule.TxState,
  typesModule.Seq,
  typesModule.DocumentCommitChange[]
> = Function.dual(
  2,
  (
    state: transactionTypesModule.TxState,
    seq: typesModule.Seq,
  ): typesModule.DocumentCommitChange[] => {
    const publications: typesModule.DocumentCommitChange[] = [];
    for (const plan of state.plans) {
      const record = committedRecord(plan, seq);
      if (plan.change !== undefined) adoptChange(state, plan, plan.change, record);
      const published = publication(state, plan, record);
      if (published !== undefined) publications.push(published);
    }
    return publications;
  },
);

const transactionAdopt = {
  adoptPlans,
};

export default transactionAdopt;
