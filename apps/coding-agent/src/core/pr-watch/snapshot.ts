import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type snapshotTypes from "./snapshot.types.ts";

const PENDING_NAME_LIMIT = 3;

const optionalString = Schema.String.pipe(Schema.NullOr, Schema.optionalKey);
const optionalComments = Schema.Unknown.pipe(Schema.Array, Schema.NullOr, Schema.optionalKey);

const RollupEntry = Schema.Struct({
  __typename: Schema.optionalKey(Schema.String),
  conclusion: optionalString,
  context: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  state: optionalString,
  status: optionalString,
  workflowName: optionalString,
});

const GhPrView = Schema.Struct({
  baseRefName: Schema.optionalKey(Schema.String),
  comments: optionalComments,
  headRefOid: Schema.optionalKey(Schema.String),
  mergeStateStatus: Schema.optionalKey(Schema.String),
  mergeable: Schema.optionalKey(Schema.String),
  reviewDecision: optionalString,
  state: Schema.String,
  statusCheckRollup: RollupEntry.pipe(Schema.Array, Schema.NullOr, Schema.optionalKey),
  updatedAt: Schema.optionalKey(Schema.String),
});

const GhPrViewJson = Schema.fromJsonString(GhPrView);

type RollupEntryValue = typeof RollupEntry.Type;

type CheckOutcome = "passed" | "failed" | "cancelled" | "pending";

function statusContextOutcome(state: string): CheckOutcome {
  if (state === "SUCCESS") return "passed";
  if (state === "PENDING" || state === "EXPECTED") return "pending";
  return "failed";
}

function checkRunOutcome(status: string, conclusion: string): CheckOutcome {
  if (status !== "COMPLETED") return "pending";
  if (conclusion === "SUCCESS" || conclusion === "NEUTRAL" || conclusion === "SKIPPED") {
    return "passed";
  }
  if (conclusion === "CANCELLED") return "cancelled";
  return "failed";
}

function rollupOutcome(entry: RollupEntryValue): CheckOutcome {
  const status = (entry.status ?? "").toUpperCase();
  const conclusion = (entry.conclusion ?? "").toUpperCase();
  const state = (entry.state ?? "").toUpperCase();
  if (entry["__typename"] === "StatusContext" || (status === "" && state !== "")) {
    return statusContextOutcome(state);
  }
  return checkRunOutcome(status, conclusion);
}

function rollupName(entry: RollupEntryValue): string {
  return entry.name ?? entry.context ?? "";
}

function checkKey(entry: RollupEntryValue): string {
  return `${entry.workflowName ?? ""}/${rollupName(entry)}`;
}

function isCancelled(entry: RollupEntryValue): boolean {
  return (entry.conclusion ?? "").toUpperCase() === "CANCELLED";
}

function withoutSupersededRuns(entries: readonly RollupEntryValue[]): RollupEntryValue[] {
  const rerun = new Set(entries.filter((entry) => !isCancelled(entry)).map(checkKey));
  return entries.filter((entry) => !isCancelled(entry) || !rerun.has(checkKey(entry)));
}

function countChecks(all: readonly RollupEntryValue[]): snapshotTypes.PrCheckCounts {
  const entries = withoutSupersededRuns(all);
  let passed = 0;
  let failed = 0;
  let cancelled = 0;
  let pending = 0;
  const pendingNames: string[] = [];
  const pendingWorkflows = new Set<string>();
  for (const entry of entries) {
    switch (rollupOutcome(entry)) {
      case "passed":
        passed += 1;
        break;
      case "failed":
        failed += 1;
        break;
      case "cancelled":
        cancelled += 1;
        break;
      case "pending": {
        pending += 1;
        pendingWorkflows.add(entry.workflowName ?? "");
        const name = rollupName(entry);
        if (name !== "" && pendingNames.length < PENDING_NAME_LIMIT) pendingNames.push(name);
        break;
      }
    }
  }
  return {
    cancelled,
    failed,
    passed,
    pending,
    pendingNames,
    pendingWorkflows: [...pendingWorkflows],
    total: entries.length,
  };
}

function parsePrView(json: string): snapshotTypes.PrSnapshot | undefined {
  const decoded = Schema.decodeOption(GhPrViewJson)(json);
  if (Option.isNone(decoded)) return undefined;
  const value = decoded.value;
  return {
    baseRefName: value.baseRefName ?? "",
    behindBy: undefined,
    checks: countChecks(value.statusCheckRollup ?? []),
    comments: value.comments?.length ?? 0,
    headRefOid: value.headRefOid ?? "",
    mergeStateStatus: (value.mergeStateStatus ?? "").toUpperCase(),
    mergeable: (value.mergeable ?? "UNKNOWN").toUpperCase(),
    reviewDecision: (value.reviewDecision ?? "").toUpperCase(),
    state: value.state.toUpperCase(),
    updatedAt: value.updatedAt ?? "",
  };
}

function describeChecks(checks: snapshotTypes.PrCheckCounts): string {
  const parts: string[] = [];
  if (checks.passed > 0) parts.push(`${checks.passed} passed`);
  if (checks.failed > 0) parts.push(`${checks.failed} failed`);
  if (checks.cancelled > 0) parts.push(`${checks.cancelled} cancelled`);
  if (checks.pending > 0) parts.push(`${checks.pending} pending`);
  return parts.length > 0 ? parts.join(", ") : "no checks";
}

function isBehind(snapshot: snapshotTypes.PrSnapshot): boolean {
  if (snapshot.mergeStateStatus === "BEHIND") return true;
  return (snapshot.behindBy ?? 0) > 0;
}

function isConflicting(snapshot: snapshotTypes.PrSnapshot): boolean {
  return snapshot.mergeable === "CONFLICTING" || snapshot.mergeStateStatus === "DIRTY";
}

const snapshot = {
  RollupEntry,
  countChecks,
  describeChecks,
  isBehind,
  isConflicting,
  parsePrView,
};

export default snapshot;
