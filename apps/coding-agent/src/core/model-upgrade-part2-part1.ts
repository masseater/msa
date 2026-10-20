import type aiTypes from "@msa/ai/index.types";
import type typesModulePart1 from "@msa/ai/types-part1.types";

import modelUpgradePart1 from "./model-upgrade-part1.ts";
import type modelUpgradeTypes from "./model-upgrade.types.ts";

const {
  compareModelVersions,
  describeReason,
  familyKey,
  findModelUpgradesPart14,
  parseModelIdVersion,
} = modelUpgradePart1;

function findModelUpgrades(
  models: readonly aiTypes.Model<aiTypes.Api>[],
): modelUpgradeTypes.ModelUpgradeCandidate[] {
  const parsed = new Map<aiTypes.Model<aiTypes.Api>, modelUpgradeTypes.ModelIdVersion>();
  for (const model of models) {
    const version = parseModelIdVersion(model.id);
    if (version !== undefined) parsed.set(model, version);
  }

  const byFamily = new Map<string, aiTypes.Model<aiTypes.Api>[]>();
  const byFamilyWithoutVariant = new Map<string, aiTypes.Model<aiTypes.Api>[]>();
  for (const [model, version] of parsed) {
    const key = familyKey(model, version);
    byFamily.set(key, [...(byFamily.get(key) ?? []), model]);
    const loose = [model.provider, version.family].join("\u0000");
    byFamilyWithoutVariant.set(loose, [...(byFamilyWithoutVariant.get(loose) ?? []), model]);
  }

  const {
    newestFirst,
    reported,
    reference,
    candidates,
  }: {
    newestFirst: (a: aiTypes.Model<aiTypes.Api>, b: aiTypes.Model<aiTypes.Api>) => number;
    reported: Set<string>;
    reference: (model: aiTypes.Model<aiTypes.Api>) => string;
    candidates: modelUpgradeTypes.ModelUpgradeCandidate[];
  } = findModelUpgradesPart8(parsed, byFamily);

  for (const family of byFamilyWithoutVariant.values()) {
    const ordered = [...family].sort(newestFirst);
    const newest = ordered[0]!;
    const newestVersion = parsed.get(newest)!;
    for (const model of ordered.slice(1)) {
      if (reported.has(reference(model))) continue;
      const version = parsed.get(model)!;
      if (version.variant === newestVersion.variant) continue;
      if (compareModelVersions(version.version, newestVersion.version) >= 0) continue;
      candidates.push({
        confident: false,
        from: model,
        reason: `${describeReason(version, newestVersion)}; variant ${version.variant || "none"} to ${newestVersion.variant || "none"}`,
        to: newest,
      });
      reported.add(reference(model));
    }
  }

  return candidates.sort(
    (a, b) =>
      a.from.provider.localeCompare(b.from.provider) ||
      a.from.id.localeCompare(b.from.id) ||
      a.to.id.localeCompare(b.to.id),
  );
}

function findModelUpgradesPart8(
  parsed: Map<aiTypes.Model<typesModulePart1.Api>, modelUpgradeTypes.ModelIdVersion>,
  byFamily: Map<string, aiTypes.Model<typesModulePart1.Api>[]>,
): {
  newestFirst: (a: aiTypes.Model<aiTypes.Api>, b: aiTypes.Model<aiTypes.Api>) => number;
  reported: Set<string>;
  reference: (model: aiTypes.Model<aiTypes.Api>) => string;
  candidates: modelUpgradeTypes.ModelUpgradeCandidate[];
} {
  return findModelUpgradesPart7(parsed, byFamily);
}

function findModelUpgradesPart7(
  parsed: Map<aiTypes.Model<typesModulePart1.Api>, modelUpgradeTypes.ModelIdVersion>,
  byFamily: Map<string, aiTypes.Model<typesModulePart1.Api>[]>,
): {
  newestFirst: (a: aiTypes.Model<aiTypes.Api>, b: aiTypes.Model<aiTypes.Api>) => number;
  reported: Set<string>;
  reference: (model: aiTypes.Model<aiTypes.Api>) => string;
  candidates: modelUpgradeTypes.ModelUpgradeCandidate[];
} {
  return findModelUpgradesPart6(parsed, byFamily);
}

function findModelUpgradesPart6(
  parsed: Map<aiTypes.Model<typesModulePart1.Api>, modelUpgradeTypes.ModelIdVersion>,
  byFamily: Map<string, aiTypes.Model<typesModulePart1.Api>[]>,
): {
  newestFirst: (a: aiTypes.Model<aiTypes.Api>, b: aiTypes.Model<aiTypes.Api>) => number;
  reported: Set<string>;
  reference: (model: aiTypes.Model<aiTypes.Api>) => string;
  candidates: modelUpgradeTypes.ModelUpgradeCandidate[];
} {
  return findModelUpgradesPart5(parsed, byFamily);
}

function findModelUpgradesPart5(
  parsed: Map<aiTypes.Model<typesModulePart1.Api>, modelUpgradeTypes.ModelIdVersion>,
  byFamily: Map<string, aiTypes.Model<typesModulePart1.Api>[]>,
): {
  newestFirst: (a: aiTypes.Model<aiTypes.Api>, b: aiTypes.Model<aiTypes.Api>) => number;
  reported: Set<string>;
  reference: (model: aiTypes.Model<aiTypes.Api>) => string;
  candidates: modelUpgradeTypes.ModelUpgradeCandidate[];
} {
  return findModelUpgradesPart4(parsed, byFamily);
}

function findModelUpgradesPart4(
  parsed: Map<aiTypes.Model<typesModulePart1.Api>, modelUpgradeTypes.ModelIdVersion>,
  byFamily: Map<string, aiTypes.Model<typesModulePart1.Api>[]>,
): {
  newestFirst: (a: aiTypes.Model<aiTypes.Api>, b: aiTypes.Model<aiTypes.Api>) => number;
  reported: Set<string>;
  reference: (model: aiTypes.Model<aiTypes.Api>) => string;
  candidates: modelUpgradeTypes.ModelUpgradeCandidate[];
} {
  return findModelUpgradesPart3(parsed, byFamily);
}

function findModelUpgradesPart3(
  parsed: Map<aiTypes.Model<typesModulePart1.Api>, modelUpgradeTypes.ModelIdVersion>,
  byFamily: Map<string, aiTypes.Model<typesModulePart1.Api>[]>,
): {
  newestFirst: (a: aiTypes.Model<aiTypes.Api>, b: aiTypes.Model<aiTypes.Api>) => number;
  reported: Set<string>;
  reference: (model: aiTypes.Model<aiTypes.Api>) => string;
  candidates: modelUpgradeTypes.ModelUpgradeCandidate[];
} {
  return findModelUpgradesPart2(parsed, byFamily);
}

function findModelUpgradesPart2(
  parsed: Map<aiTypes.Model<typesModulePart1.Api>, modelUpgradeTypes.ModelIdVersion>,
  byFamily: Map<string, aiTypes.Model<typesModulePart1.Api>[]>,
): {
  newestFirst: (a: aiTypes.Model<aiTypes.Api>, b: aiTypes.Model<aiTypes.Api>) => number;
  reported: Set<string>;
  reference: (model: aiTypes.Model<aiTypes.Api>) => string;
  candidates: modelUpgradeTypes.ModelUpgradeCandidate[];
} {
  return findModelUpgradesPart1(parsed, byFamily);
}

function findModelUpgradesPart1(
  parsed: Map<aiTypes.Model<typesModulePart1.Api>, modelUpgradeTypes.ModelIdVersion>,
  byFamily: Map<string, aiTypes.Model<typesModulePart1.Api>[]>,
): {
  newestFirst: (a: aiTypes.Model<aiTypes.Api>, b: aiTypes.Model<aiTypes.Api>) => number;
  reported: Set<string>;
  reference: (model: aiTypes.Model<aiTypes.Api>) => string;
  candidates: modelUpgradeTypes.ModelUpgradeCandidate[];
} {
  return findModelUpgradesPart15(parsed, byFamily);
}

function findModelUpgradesPart15(
  parsed: Map<aiTypes.Model<typesModulePart1.Api>, modelUpgradeTypes.ModelIdVersion>,
  byFamily: Map<string, aiTypes.Model<typesModulePart1.Api>[]>,
): {
  newestFirst: (a: aiTypes.Model<aiTypes.Api>, b: aiTypes.Model<aiTypes.Api>) => number;
  reported: Set<string>;
  reference: (model: aiTypes.Model<aiTypes.Api>) => string;
  candidates: modelUpgradeTypes.ModelUpgradeCandidate[];
} {
  return findModelUpgradesPart14(parsed, byFamily);
}

function findModelUpgrade(
  candidates: readonly modelUpgradeTypes.ModelUpgradeCandidate[],
  reference: string,
): modelUpgradeTypes.ModelUpgradeCandidate | undefined {
  const text = reference.trim().toLowerCase();
  return candidates.find(
    (candidate) =>
      `${candidate.from.provider}/${candidate.from.id}`.toLowerCase() === text ||
      candidate.from.id.toLowerCase() === text,
  );
}

function createUpgradeReplacements(
  candidates: readonly modelUpgradeTypes.ModelUpgradeCandidate[],
): Map<string, string> {
  const replacements = new Map<string, string>();
  for (const candidate of candidates) {
    if (!candidate.confident) continue;
    replacements.set([candidate.from.provider, candidate.from.id].join("\u0000"), candidate.to.id);
  }
  return replacements;
}

function splitThinkingSuffix(reference: string): { base: string; suffix: string } {
  const colon = reference.lastIndexOf(":");
  if (colon === -1) return { base: reference, suffix: "" };
  return { base: reference.slice(0, colon), suffix: reference.slice(colon) };
}

function upgradeModelReference(
  reference: string,
  replacements: ReadonlyMap<string, string>,
  options: { provider?: string | undefined } = {},
): string | undefined {
  if (replacements.size === 0) return undefined;
  const { base, suffix } = splitThinkingSuffix(reference.trim());
  const slash = base.indexOf("/");
  if (slash > 0) {
    const provider = base.slice(0, slash);
    const modelId = base.slice(slash + 1);
    const replacement = replacements.get([provider, modelId].join("\u0000"));
    return replacement === undefined ? undefined : `${provider}/${replacement}${suffix}`;
  }
  const provider = options.provider;
  if (provider !== undefined) {
    const replacement = replacements.get([provider, base].join("\u0000"));
    return replacement === undefined ? undefined : `${replacement}${suffix}`;
  }

  const providers = [...replacements.keys()]
    .filter((key) => key.slice(key.indexOf("\u0000") + 1) === base)
    .map((key) => key.slice(0, key.indexOf("\u0000")));
  const only = providers[0];
  if (providers.length !== 1 || only === undefined) return undefined;
  const replacement = replacements.get([only, base].join("\u0000"));
  return replacement === undefined ? undefined : `${replacement}${suffix}`;
}

function rewriteString(
  settings: Record<string, unknown>,
  key: string,
  rewrite: (value: string) => string | undefined,
  changes: modelUpgradeTypes.ModelReferenceChange[],
  path = key,
): void {
  const current = settings[key];
  if (typeof current !== "string") return;
  const next = rewrite(current);
  if (next === undefined || next === current) return;
  settings[key] = next;
  changes.push({ from: current, setting: path, to: next });
}

function rewriteStringArray(
  settings: Record<string, unknown>,
  key: string,
  rewrite: (value: string) => string | undefined,
  changes: modelUpgradeTypes.ModelReferenceChange[],
  path = `${key}[]`,
): void {
  const current = settings[key];
  if (!Array.isArray(current)) return;
  let changed = false;
  const next = current.map((entry) => {
    if (typeof entry !== "string") return entry;
    const replacement = rewrite(entry);
    if (replacement === undefined || replacement === entry) return entry;
    changed = true;
    changes.push({ from: entry, setting: path, to: replacement });
    return replacement;
  });
  if (changed) settings[key] = next;
}

const modelUpgradePart2Part1 = {
  createUpgradeReplacements,
  findModelUpgrade,
  findModelUpgrades,
  rewriteString,
  rewriteStringArray,
  splitThinkingSuffix,
  upgradeModelReference,
};

export default modelUpgradePart2Part1;
