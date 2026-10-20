import { dual } from "effect/Function";

import type { DocumentationVariant } from "./plan.ts";
import type {
  BlockedPair,
  EvalComparisonReport,
  EvalObservation,
  EvalRunIdentity,
  EvalSetComparison,
  ExpectedEvalRun,
  OperationalMetricTotal,
  PairedMetricSummary,
  VariantTotals,
} from "./report-types.ts";

const CONTROL = "without_docs";
const TREATMENT = "with_docs";
const VARIANTS = [CONTROL, TREATMENT] as const;

type Pair = {
  control: EvalObservation & { outcome: "scored" };
  treatment: EvalObservation & { outcome: "scored" };
};
type PairGroup = Omit<EvalRunIdentity, "variant"> & {
  expected: Map<DocumentationVariant, number>;
  observations: Map<DocumentationVariant, EvalObservation[]>;
};

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function difference(treatment: number, control: number): number {
  return Number((treatment - control).toPrecision(15));
}

function pairKey(identity: Omit<EvalRunIdentity, "variant">): string {
  return JSON.stringify([identity.evalSet, identity.caseId, identity.model, identity.runNumber]);
}

function groupPairs(
  expectedRuns: readonly ExpectedEvalRun[],
  observations: readonly EvalObservation[],
): PairGroup[] {
  const groups = new Map<string, PairGroup>();
  const getGroup = (identity: EvalRunIdentity): PairGroup => {
    const key = pairKey(identity);
    const existing = groups.get(key);
    if (existing !== undefined) return existing;
    const group = {
      caseId: identity.caseId,
      evalSet: identity.evalSet,
      expected: new Map<DocumentationVariant, number>(),
      model: identity.model,
      observations: new Map<DocumentationVariant, EvalObservation[]>(),
      runNumber: identity.runNumber,
    };
    groups.set(key, group);
    return group;
  };
  for (const expected of expectedRuns) {
    const group = getGroup(expected);
    group.expected.set(expected.variant, (group.expected.get(expected.variant) ?? 0) + 1);
  }
  for (const observation of observations) {
    const group = getGroup(observation);
    const runs = group.observations.get(observation.variant) ?? [];
    runs.push(observation);
    group.observations.set(observation.variant, runs);
  }
  return [...groups.values()].sort(
    (left, right) =>
      left.evalSet.localeCompare(right.evalSet) ||
      left.caseId.localeCompare(right.caseId) ||
      left.model.localeCompare(right.model) ||
      left.runNumber - right.runNumber,
  );
}

function resolvePair(group: PairGroup): { pair?: Pair; blocked?: BlockedPair } {
  const reasons: string[] = [];
  for (const variant of VARIANTS) {
    const expected = group.expected.get(variant) ?? 0;
    const observed = group.observations.get(variant) ?? [];
    if (expected !== 1) reasons.push(`${variant}: design expected 1 run, found ${expected}`);
    if (observed.length !== expected) {
      reasons.push(
        `${variant}: expected ${expected} observation${expected === 1 ? "" : "s"}, found ${observed.length}`,
      );
    }
    const single = observed.length === 1 ? observed[0] : undefined;
    if (expected === 1 && single !== undefined && single.outcome !== "scored") {
      reasons.push(`${variant}: ${single.outcome}`);
    }
  }
  if (reasons.length > 0) {
    return {
      blocked: {
        caseId: group.caseId,
        evalSet: group.evalSet,
        model: group.model,
        reasons,
        runNumber: group.runNumber,
      },
    };
  }
  return {
    pair: {
      control: group.observations.get(CONTROL)![0] as EvalObservation & { outcome: "scored" },
      treatment: group.observations.get(TREATMENT)![0] as EvalObservation & { outcome: "scored" },
    },
  };
}

function summarizeMetric(
  pairs: readonly Pair[],
  select: (observation: EvalObservation) => number | undefined,
): PairedMetricSummary {
  const control: number[] = [];
  const treatment: number[] = [];
  for (const pair of pairs) {
    const controlValue = select(pair.control);
    const treatmentValue = select(pair.treatment);
    if (controlValue === undefined || treatmentValue === undefined) continue;
    control.push(controlValue);
    treatment.push(treatmentValue);
  }
  const controlMean = mean(control);
  const treatmentMean = mean(treatment);
  return {
    controlMean,
    eligiblePairs: control.length,
    meanDelta:
      controlMean === null || treatmentMean === null
        ? null
        : difference(treatmentMean, controlMean),
    treatmentMean,
  };
}

function operationalTotal(
  runs: readonly EvalObservation[],
  select: (observation: EvalObservation) => number | undefined,
): OperationalMetricTotal {
  const values = runs.flatMap((run) => {
    const value = select(run);
    return value === undefined ? [] : [value];
  });
  return {
    availableRuns: values.length,
    total: values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0),
  };
}

function variantTotals(
  observations: readonly EvalObservation[],
  variant: DocumentationVariant,
): VariantTotals {
  const runs = observations.filter((observation) => observation.variant === variant);
  return {
    cacheReadTokens: operationalTotal(runs, ({ cacheReadTokens }) => cacheReadTokens),
    cacheWriteTokens: operationalTotal(runs, ({ cacheWriteTokens }) => cacheWriteTokens),
    estimatedCostUsd: operationalTotal(runs, ({ estimatedCostUsd }) => estimatedCostUsd),
    inputTokens: operationalTotal(runs, ({ inputTokens }) => inputTokens),
    outputTokens: operationalTotal(runs, ({ outputTokens }) => outputTokens),
    runs: runs.length,
    toolCalls: operationalTotal(runs, ({ toolCalls }) => toolCalls),
    totalMs: operationalTotal(runs, ({ totalMs }) => totalMs),
    totalTokens: operationalTotal(runs, ({ totalTokens }) => totalTokens),
    variant,
  };
}

function comparisonFlags(
  pairs: readonly Pair[],
  controlPassRate: number | null,
  treatmentPassRate: number | null,
) {
  const flags: Array<
    "no-lift" | "negative-delta" | "control-saturated" | "treatment-saturated" | "flaky"
  > = [];
  if (controlPassRate !== null && treatmentPassRate !== null) {
    if (controlPassRate === treatmentPassRate) flags.push("no-lift");
    if (treatmentPassRate < controlPassRate) flags.push("negative-delta");
    if (controlPassRate === 1) flags.push("control-saturated");
    if (treatmentPassRate === 1) flags.push("treatment-saturated");
  }
  const outcomes = new Map<string, Set<string>>();
  for (const pair of pairs) {
    const key = JSON.stringify([pair.control.caseId, pair.control.variant]);
    const control = outcomes.get(key) ?? new Set<string>();
    control.add(String(pair.control.score >= 1));
    outcomes.set(key, control);
    const treatmentKey = JSON.stringify([pair.treatment.caseId, pair.treatment.variant]);
    const treatment = outcomes.get(treatmentKey) ?? new Set<string>();
    treatment.add(String(pair.treatment.score >= 1));
    outcomes.set(treatmentKey, treatment);
  }
  if ([...outcomes.values()].some((values) => values.size > 1)) flags.push("flaky");
  return flags;
}

function comparisonFor(
  evalSet: string,
  totalPairs: number,
  pairs: readonly Pair[],
): EvalSetComparison {
  const blockedPairCount = totalPairs - pairs.length;
  const publishHeadline = blockedPairCount === 0 && pairs.length > 0;
  const controlPassRate = publishHeadline
    ? pairs.filter(({ control }) => control.score >= 1).length / pairs.length
    : null;
  const treatmentPassRate = publishHeadline
    ? pairs.filter(({ treatment }) => treatment.score >= 1).length / pairs.length
    : null;
  return {
    blockedPairs: blockedPairCount,
    controlPassRate,
    eligiblePairs: pairs.length,
    estimatedCostUsd: summarizeMetric(pairs, ({ estimatedCostUsd }) => estimatedCostUsd),
    evalSet,
    flags: comparisonFlags(pairs, controlPassRate, treatmentPassRate),
    lift:
      controlPassRate === null || treatmentPassRate === null
        ? null
        : difference(treatmentPassRate, controlPassRate),
    toolCalls: summarizeMetric(pairs, ({ toolCalls }) => toolCalls),
    totalMs: summarizeMetric(pairs, ({ totalMs }) => totalMs),
    totalPairs,
    totalTokens: summarizeMetric(pairs, ({ totalTokens }) => totalTokens),
    treatmentPassRate,
  };
}

function classifyGroups(groups: readonly PairGroup[]) {
  const blockedPairs: BlockedPair[] = [];
  const pairsByEvalSet = new Map<string, Pair[]>();
  const totalsByEvalSet = new Map<string, number>();
  for (const group of groups) {
    totalsByEvalSet.set(group.evalSet, (totalsByEvalSet.get(group.evalSet) ?? 0) + 1);
    const { pair, blocked } = resolvePair(group);
    if (blocked !== undefined) blockedPairs.push(blocked);
    if (pair !== undefined) {
      pairsByEvalSet.set(group.evalSet, [...(pairsByEvalSet.get(group.evalSet) ?? []), pair]);
    }
  }
  return { blockedPairs, pairsByEvalSet, totalsByEvalSet };
}

export const summarizeEvalObservations: {
  (
    expectedRuns: readonly ExpectedEvalRun[],
    observations: readonly EvalObservation[],
  ): (protocolDigest: string) => EvalComparisonReport;
  (
    protocolDigest: string,
    expectedRuns: readonly ExpectedEvalRun[],
    observations: readonly EvalObservation[],
  ): EvalComparisonReport;
} = dual(
  3,
  (
    protocolDigest: string,
    expectedRuns: readonly ExpectedEvalRun[],
    observations: readonly EvalObservation[],
  ): EvalComparisonReport => {
    const { blockedPairs, pairsByEvalSet, totalsByEvalSet } = classifyGroups(
      groupPairs(expectedRuns, observations),
    );
    const comparisons = [...totalsByEvalSet]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([evalSet, totalPairs]) =>
        comparisonFor(evalSet, totalPairs, pairsByEvalSet.get(evalSet) ?? []),
      );
    return {
      blockedPairs,
      comparisons,
      control: CONTROL,
      operationalTotals: [
        variantTotals(observations, CONTROL),
        variantTotals(observations, TREATMENT),
      ],
      protocolDigest,
      schemaVersion: 3,
      treatment: TREATMENT,
    };
  },
);
