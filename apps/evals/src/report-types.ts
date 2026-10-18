import type { DocumentationVariant } from "./plan.ts";

export const MSA_SESSION_SNAPSHOT_ARTIFACT = "msaSessionJsonl";

export type EvalRunIdentity = {
  evalSet: string;
  caseId: string;
  variant: DocumentationVariant;
  model: string;
  runNumber: number;
};

export type ExpectedEvalRun = EvalRunIdentity;

export type EvalMetrics = {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  cacheReadTokens?: number | undefined;
  cacheWriteTokens?: number | undefined;
  totalTokens?: number | undefined;
  toolCalls?: number | undefined;
  totalMs?: number | undefined;
  estimatedCostUsd?: number | undefined;
};

export type EvalObservation = EvalRunIdentity &
  EvalMetrics &
  (
    | { outcome: "scored"; score: number }
    | { outcome: "unscored" | "skipped" | "pending" | "errored" }
  );

export type PairedMetricSummary = {
  eligiblePairs: number;
  controlMean: number | null;
  treatmentMean: number | null;
  meanDelta: number | null;
};

export type EvalSetComparison = {
  evalSet: string;
  totalPairs: number;
  eligiblePairs: number;
  blockedPairs: number;
  controlPassRate: number | null;
  treatmentPassRate: number | null;
  lift: number | null;
  flags: Array<
    "no-lift" | "negative-delta" | "control-saturated" | "treatment-saturated" | "flaky"
  >;
  totalTokens: PairedMetricSummary;
  toolCalls: PairedMetricSummary;
  totalMs: PairedMetricSummary;
  estimatedCostUsd: PairedMetricSummary;
};

export type BlockedPair = Omit<EvalRunIdentity, "variant"> & { reasons: string[] };

export type OperationalMetricTotal = { availableRuns: number; total: number | null };

export type VariantTotals = {
  variant: DocumentationVariant;
  runs: number;
  inputTokens: OperationalMetricTotal;
  outputTokens: OperationalMetricTotal;
  cacheReadTokens: OperationalMetricTotal;
  cacheWriteTokens: OperationalMetricTotal;
  totalTokens: OperationalMetricTotal;
  toolCalls: OperationalMetricTotal;
  totalMs: OperationalMetricTotal;
  estimatedCostUsd: OperationalMetricTotal;
};

export type EvalComparisonReport = {
  schemaVersion: 3;
  protocolDigest: string;
  control: "without_docs";
  treatment: "with_docs";
  comparisons: EvalSetComparison[];
  blockedPairs: BlockedPair[];
  operationalTotals: VariantTotals[];
};
