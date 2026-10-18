import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export interface PrWatchTarget {
  readonly number: number;
  readonly repository?: string | undefined;
}

export interface PrCheckCounts {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly pending: number;
}

export interface PrSnapshot {
  readonly state: string;
  readonly mergeable: string;
  readonly mergeStateStatus: string;
  readonly reviewDecision: string;
  readonly updatedAt: string;
  readonly comments: number;
  readonly checks: PrCheckCounts;
}

const optionalString = Schema.String.pipe(Schema.NullOr, Schema.optionalKey);
const optionalComments = Schema.Unknown.pipe(Schema.Array, Schema.NullOr, Schema.optionalKey);

const RollupEntry = Schema.Struct({
  __typename: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  context: Schema.optionalKey(Schema.String),
  status: optionalString,
  conclusion: optionalString,
  state: optionalString,
});

const GhPrView = Schema.Struct({
  state: Schema.String,
  mergeable: Schema.optionalKey(Schema.String),
  mergeStateStatus: Schema.optionalKey(Schema.String),
  reviewDecision: optionalString,
  comments: optionalComments,
  statusCheckRollup: RollupEntry.pipe(Schema.Array, Schema.NullOr, Schema.optionalKey),
  updatedAt: Schema.optionalKey(Schema.String),
});

const GhPrViewJson = Schema.fromJsonString(GhPrView);

type RollupEntryValue = typeof RollupEntry.Type;

type CheckOutcome = "passed" | "failed" | "pending";

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
  return "failed";
}

function rollupOutcome(entry: RollupEntryValue): CheckOutcome {
  const status = (entry.status ?? "").toUpperCase();
  const conclusion = (entry.conclusion ?? "").toUpperCase();
  const state = (entry.state ?? "").toUpperCase();
  if (entry.__typename === "StatusContext" || (status === "" && state !== "")) {
    return statusContextOutcome(state);
  }
  return checkRunOutcome(status, conclusion);
}

function countChecks(entries: readonly RollupEntryValue[]): PrCheckCounts {
  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const entry of entries) {
    switch (rollupOutcome(entry)) {
      case "passed":
        passed += 1;
        break;
      case "failed":
        failed += 1;
        break;
      case "pending":
        pending += 1;
        break;
    }
  }
  return { total: entries.length, passed, failed, pending };
}

export function parsePrView(json: string): PrSnapshot | undefined {
  const decoded = Schema.decodeOption(GhPrViewJson)(json);
  if (Option.isNone(decoded)) return undefined;
  const value = decoded.value;
  return {
    state: value.state.toUpperCase(),
    mergeable: (value.mergeable ?? "UNKNOWN").toUpperCase(),
    mergeStateStatus: (value.mergeStateStatus ?? "").toUpperCase(),
    reviewDecision: (value.reviewDecision ?? "").toUpperCase(),
    updatedAt: value.updatedAt ?? "",
    comments: value.comments?.length ?? 0,
    checks: countChecks(value.statusCheckRollup ?? []),
  };
}

export function describeChecks(checks: PrCheckCounts): string {
  const parts: string[] = [];
  if (checks.passed > 0) parts.push(`${checks.passed} passed`);
  if (checks.failed > 0) parts.push(`${checks.failed} failed`);
  if (checks.pending > 0) parts.push(`${checks.pending} pending`);
  return parts.length > 0 ? parts.join(", ") : "no checks";
}
