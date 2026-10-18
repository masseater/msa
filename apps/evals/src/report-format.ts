import { styleText } from "node:util";

import type {
  EvalComparisonReport,
  EvalSetComparison,
  OperationalMetricTotal,
  PairedMetricSummary,
  VariantTotals,
} from "./report-types.ts";

function percentage(value: number | null): string {
  return value === null ? "unavailable" : `${(value * 100).toFixed(1)}%`;
}

function signed(value: number, digits: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function pairedMetric(label: string, metric: PairedMetricSummary, unit = ""): string {
  if (metric.meanDelta === null || metric.controlMean === null || metric.treatmentMean === null) {
    return `    ${label.padStart(10)}  unavailable`;
  }
  return `    ${label.padStart(10)}  ${signed(metric.meanDelta, 1)}${unit} (with ${metric.treatmentMean.toFixed(1)}${unit}, without ${metric.controlMean.toFixed(1)}${unit}, ${metric.eligiblePairs} pairs)`;
}

function operationalMetric(
  metric: OperationalMetricTotal,
  runs: number,
  format: (total: number) => string,
): string {
  if (metric.total === null) return `unavailable (0/${runs} measured)`;
  const coverage =
    metric.availableRuns === runs ? "" : ` (${metric.availableRuns}/${runs} measured)`;
  return `${format(metric.total)}${coverage}`;
}

function comparisonLines(comparison: EvalSetComparison): string[] {
  const lines = [
    `  ${comparison.evalSet}`,
    `         Pairs  ${comparison.eligiblePairs}/${comparison.totalPairs} eligible`,
  ];
  if (comparison.lift === null) {
    lines.push(
      comparison.blockedPairs > 0
        ? "     Pass rate  withheld because pairs are blocked"
        : "     Pass rate  unavailable",
    );
  } else {
    lines.push(
      `     Pass rate  ${signed(comparison.lift * 100, 1)} pp (with ${percentage(comparison.treatmentPassRate)}, without ${percentage(comparison.controlPassRate)})`,
    );
  }
  if (comparison.flags.length > 0) lines.push(`         Flags  ${comparison.flags.join(", ")}`);
  lines.push(
    pairedMetric("Tokens", comparison.totalTokens),
    pairedMetric("Tools", comparison.toolCalls),
    pairedMetric("Latency", comparison.totalMs, "ms"),
  );
  const cost = comparison.estimatedCostUsd;
  if (cost.meanDelta === null || cost.controlMean === null || cost.treatmentMean === null) {
    lines.push("     Est. cost  unavailable");
  } else {
    lines.push(
      `     Est. cost  ${cost.meanDelta >= 0 ? "+" : "-"}$${Math.abs(cost.meanDelta).toFixed(4)} (with $${cost.treatmentMean.toFixed(4)}, without $${cost.controlMean.toFixed(4)}, ${cost.eligiblePairs} pairs)`,
    );
  }
  return lines;
}

function totalsLine(totals: VariantTotals): string {
  const tokens = operationalMetric(totals.totalTokens, totals.runs, (total) => `${total} tokens`);
  const tools = operationalMetric(totals.toolCalls, totals.runs, (total) => `${total} tools`);
  const latency = operationalMetric(
    totals.totalMs,
    totals.runs,
    (total) => `${(total / 1000).toFixed(2)}s`,
  );
  const cost = operationalMetric(
    totals.estimatedCostUsd,
    totals.runs,
    (total) => `$${total.toFixed(4)} cost`,
  );
  return `    ${totals.variant}: ${totals.runs} runs, ${tokens}, ${tools}, ${latency}, ${cost}`;
}

export function formatEvalComparisonReport(report: EvalComparisonReport): string {
  if (report.comparisons.length === 0) return "";
  const lines = [
    styleText("bold", "Documentation Eval Comparisons"),
    ...report.comparisons.flatMap(comparisonLines),
    "  Operational totals",
    ...report.operationalTotals.map(totalsLine),
  ];
  if (report.blockedPairs.length > 0) {
    lines.push("  Blocked pairs");
    for (const blocked of report.blockedPairs) {
      lines.push(
        `    ${blocked.evalSet}/${blocked.caseId}/${blocked.model}/run-${blocked.runNumber}: ${blocked.reasons.join("; ")}`,
      );
    }
  }
  return lines.join("\n");
}
