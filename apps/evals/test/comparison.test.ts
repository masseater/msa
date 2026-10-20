import { stripVTControlCharacters } from "node:util";

import { describe, expect, it } from "vite-plus/test";

import reportFormat from "../src/report-format.ts";
import reportSummary from "../src/report-summary.ts";
import type reportTypesTypes from "../src/report-types.types.ts";

const { summarizeEvalObservations } = reportSummary;
const { formatEvalComparisonReport } = reportFormat;

function scored(
  variant: reportTypesTypes.EvalObservation["variant"],
  runNumber: number,
  score: number,
  metrics: Partial<{
    totalTokens: number;
    toolCalls: number;
    totalMs: number;
    estimatedCostUsd: number;
  }> = {},
): reportTypesTypes.EvalObservation {
  return {
    caseId: "create",
    estimatedCostUsd: 0.01,
    evalSet: "tool access",
    model: "fixture/model",
    outcome: "scored",
    runNumber,
    score,
    toolCalls: 2,
    totalMs: 1000,
    totalTokens: 100,
    variant,
    ...metrics,
  };
}

function errored(
  variant: reportTypesTypes.EvalObservation["variant"],
  runNumber: number,
  totalTokens?: number,
): reportTypesTypes.EvalObservation {
  return {
    caseId: "create",
    evalSet: "tool access",
    model: "fixture/model",
    outcome: "errored",
    runNumber,
    totalTokens,
    variant,
  };
}

function expectedFor(runNumbers: readonly number[]): reportTypesTypes.ExpectedEvalRun[] {
  return runNumbers.flatMap((runNumber) =>
    (["without_docs", "with_docs"] as const).map((variant) => ({
      caseId: "create",
      evalSet: "tool access",
      model: "fixture/model",
      runNumber,
      variant,
    })),
  );
}

describe("summarizeEvalObservations", () => {
  it("computes paired lift and efficiency deltas", () => {
    const observations = [
      scored("without_docs", 1, 0, { toolCalls: 3, totalMs: 1000, totalTokens: 100 }),
      scored("with_docs", 1, 1, { toolCalls: 2, totalMs: 800, totalTokens: 120 }),
      scored("without_docs", 2, 1, { totalTokens: 200 }),
      scored("with_docs", 2, 1, { totalTokens: 180 }),
    ];
    const report = summarizeEvalObservations("digest", expectedFor([1, 2]), observations);
    expect(report.comparisons).toEqual([
      expect.objectContaining({
        blockedPairs: 0,
        controlPassRate: 0.5,
        eligiblePairs: 2,
        evalSet: "tool access",
        lift: 0.5,
        toolCalls: { controlMean: 2.5, eligiblePairs: 2, meanDelta: -0.5, treatmentMean: 2 },
        totalPairs: 2,
        totalTokens: { controlMean: 150, eligiblePairs: 2, meanDelta: 0, treatmentMean: 150 },
        treatmentPassRate: 1,
      }),
    ]);
  });

  it("fails closed for incomplete and errored pairs while retaining totals", () => {
    const observations: reportTypesTypes.EvalObservation[] = [
      scored("without_docs", 1, 0),
      errored("with_docs", 1, 120),
      scored("without_docs", 2, 1, { totalTokens: 200 }),
    ];
    const report = summarizeEvalObservations("digest", expectedFor([1, 2]), observations);
    expect(report.comparisons[0]).toEqual(
      expect.objectContaining({ blockedPairs: 2, eligiblePairs: 0, lift: null, totalPairs: 2 }),
    );
    expect(report.blockedPairs).toEqual([
      expect.objectContaining({ reasons: ["with_docs: errored"], runNumber: 1 }),
      expect.objectContaining({
        reasons: ["with_docs: expected 1 observation, found 0"],
        runNumber: 2,
      }),
    ]);
    expect(report.operationalTotals[0]?.totalTokens).toEqual({ availableRuns: 2, total: 300 });
  });
});

describe("summarizeEvalObservations metrics", () => {
  it("blocks duplicate observations and keeps missing metrics distinct from zero", () => {
    const withoutTokens = scored("without_docs", 1, 1);
    delete withoutTokens.totalTokens;
    const report = summarizeEvalObservations("digest", expectedFor([1]), [
      withoutTokens,
      withoutTokens,
      scored("with_docs", 1, 1, { totalTokens: 0 }),
    ]);
    expect(report.blockedPairs[0]?.reasons).toEqual([
      "without_docs: expected 1 observation, found 2",
    ]);
    expect(report.operationalTotals[0]?.totalTokens).toEqual({ availableRuns: 0, total: null });
    expect(report.operationalTotals[1]?.totalTokens).toEqual({ availableRuns: 1, total: 0 });
  });

  it("formats blocked comparisons and operational totals", () => {
    const report = summarizeEvalObservations("digest", expectedFor([1, 2]), [
      scored("without_docs", 1, 1),
      scored("with_docs", 1, 1),
    ]);
    const formatted = stripVTControlCharacters(formatEvalComparisonReport(report));
    expect(formatted).toContain("Documentation Eval Comparisons");
    expect(formatted).toContain("Pass rate  withheld because pairs are blocked");
    expect(formatted).toContain("without_docs: 1 runs");
  });
});
