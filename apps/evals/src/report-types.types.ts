import type planTypes from "./plan.types.ts";

declare namespace reportTypesTypes {
  type EvalRunIdentity = {
    evalSet: string;
    caseId: string;
    variant: planTypes.DocumentationVariant;
    model: string;
    runNumber: number;
  };

  type ExpectedEvalRun = EvalRunIdentity;

  type EvalMetrics = {
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
    cacheReadTokens?: number | undefined;
    cacheWriteTokens?: number | undefined;
    totalTokens?: number | undefined;
    toolCalls?: number | undefined;
    totalMs?: number | undefined;
    estimatedCostUsd?: number | undefined;
  };

  type EvalObservation = EvalRunIdentity &
    EvalMetrics &
    (
      | { outcome: "scored"; score: number }
      | { outcome: "unscored" | "skipped" | "pending" | "errored" }
    );

  type PairedMetricSummary = {
    eligiblePairs: number;
    controlMean: number | null;
    treatmentMean: number | null;
    meanDelta: number | null;
  };

  type EvalSetComparison = {
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

  type BlockedPair = Omit<EvalRunIdentity, "variant"> & { reasons: string[] };

  type OperationalMetricTotal = { availableRuns: number; total: number | null };

  type VariantTotals = {
    variant: planTypes.DocumentationVariant;
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

  type EvalComparisonReport = {
    schemaVersion: 3;
    protocolDigest: string;
    control: "without_docs";
    treatment: "with_docs";
    comparisons: EvalSetComparison[];
    blockedPairs: BlockedPair[];
    operationalTotals: VariantTotals[];
  };
}

export type { reportTypesTypes as default };
