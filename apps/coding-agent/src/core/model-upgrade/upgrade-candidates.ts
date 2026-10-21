import type aiTypes from "@msa/ai/index.types";

import type modelUpgradeTypes from "../model-upgrade.types.ts";
import modelVersions from "./model-versions.ts";

const { compareDates, compareModelVersions, describeReason, parseModelIdVersion } = modelVersions;

type Model = aiTypes.Model<aiTypes.Api>;
type Candidate = modelUpgradeTypes.ModelUpgradeCandidate;
type Parsed = Map<Model, modelUpgradeTypes.ModelIdVersion>;

const KEY_SEPARATOR = "\u0000";

const reference = (model: Model): string => `${model.provider}/${model.id}`;

function parseAll(models: readonly Model[]): Parsed {
  const parsed: Parsed = new Map();
  for (const model of models) {
    const version = parseModelIdVersion(model.id);
    if (version !== undefined) parsed.set(model, version);
  }
  return parsed;
}

function groupBy(parsed: Parsed, keyOf: (model: Model) => string): Map<string, Model[]> {
  const groups = new Map<string, Model[]>();
  for (const model of parsed.keys()) {
    const key = keyOf(model);
    groups.set(key, [...(groups.get(key) ?? []), model]);
  }
  return groups;
}

function newestFirst(parsed: Parsed): (a: Model, b: Model) => number {
  return (a, b) => {
    const left = parsed.get(a)!;
    const right = parsed.get(b)!;
    return compareModelVersions(right.version, left.version) || compareDates(right.date, left.date);
  };
}

function sameVariantCandidates(parsed: Parsed, family: readonly Model[]): Candidate[] {
  const [newest, ...older] = [...family].sort(newestFirst(parsed));
  const newestVersion = parsed.get(newest!)!;
  return older.map((model) => ({
    confident: true,
    from: model,
    reason: describeReason(parsed.get(model)!, newestVersion),
    to: newest!,
  }));
}

function otherVariantCandidates(
  parsed: Parsed,
  family: readonly Model[],
  reported: ReadonlySet<string>,
): Candidate[] {
  const [newest, ...older] = [...family].sort(newestFirst(parsed));
  const newestVersion = parsed.get(newest!)!;
  const candidates: Candidate[] = [];
  for (const model of older) {
    if (reported.has(reference(model))) continue;
    const version = parsed.get(model)!;
    if (version.variant === newestVersion.variant) continue;
    if (compareModelVersions(version.version, newestVersion.version) >= 0) continue;
    candidates.push({
      confident: false,
      from: model,
      reason: `${describeReason(version, newestVersion)}; variant ${version.variant || "none"} to ${newestVersion.variant || "none"}`,
      to: newest!,
    });
  }
  return candidates;
}

function findModelUpgrades(models: readonly Model[]): Candidate[] {
  const parsed = parseAll(models);
  const familyOf = (model: Model) => [model.provider, parsed.get(model)!.family];
  const byFamily = groupBy(parsed, (model) =>
    [...familyOf(model), parsed.get(model)!.variant].join(KEY_SEPARATOR),
  );
  const byFamilyWithoutVariant = groupBy(parsed, (model) => familyOf(model).join(KEY_SEPARATOR));

  const candidates = [...byFamily.values()].flatMap((family) =>
    sameVariantCandidates(parsed, family),
  );
  const reported = new Set(candidates.map((candidate) => reference(candidate.from)));
  for (const family of byFamilyWithoutVariant.values()) {
    candidates.push(...otherVariantCandidates(parsed, family, reported));
  }

  return candidates.sort(
    (a, b) =>
      a.from.provider.localeCompare(b.from.provider) ||
      a.from.id.localeCompare(b.from.id) ||
      a.to.id.localeCompare(b.to.id),
  );
}

function findModelUpgrade(candidates: readonly Candidate[], query: string): Candidate | undefined {
  const text = query.trim().toLowerCase();
  return candidates.find(
    (candidate) =>
      reference(candidate.from).toLowerCase() === text || candidate.from.id.toLowerCase() === text,
  );
}

function createUpgradeReplacements(candidates: readonly Candidate[]): Map<string, string> {
  const replacements = new Map<string, string>();
  for (const candidate of candidates) {
    if (!candidate.confident) continue;
    replacements.set(
      [candidate.from.provider, candidate.from.id].join(KEY_SEPARATOR),
      candidate.to.id,
    );
  }
  return replacements;
}

const upgradeCandidates = { createUpgradeReplacements, findModelUpgrade, findModelUpgrades };

export default upgradeCandidates;
