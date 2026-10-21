import type modelUpgradeTypes from "./model-upgrade.types.ts";
import modelReferences from "./model-upgrade/model-references.ts";
import modelVersions from "./model-upgrade/model-versions.ts";
import upgradeCandidates from "./model-upgrade/upgrade-candidates.ts";
import type settingsSchemaTypes from "./settings-schema.types.ts";

const { rewriteModelReferencesInSettings, splitThinkingSuffix, upgradeModelReference } =
  modelReferences;
const { compareModelVersions, parseModelIdVersion } = modelVersions;
const { createUpgradeReplacements, findModelUpgrade, findModelUpgrades } = upgradeCandidates;

type Candidate = modelUpgradeTypes.ModelUpgradeCandidate;

function planModelUpgrades(options: {
  candidates: readonly Candidate[];
  layers: { global: settingsSchemaTypes.Settings; project: settingsSchemaTypes.Settings };
  selected?: readonly Candidate[];
}): modelUpgradeTypes.ModelUpgradePlan {
  const selected = options.selected ?? options.candidates;
  const replacements = createUpgradeReplacements(selected);
  const changes: modelUpgradeTypes.ModelUpgradePlan["changes"] = [];
  for (const scope of ["global", "project"] as const) {
    const layer = structuredClone(options.layers[scope]);
    for (const change of rewriteModelReferencesInSettings(layer, replacements)) {
      changes.push({ ...change, scope });
    }
  }
  const unreachable: string[] = [];
  if (replacements.size > 0) {
    unreachable.push("Session transcripts keep the model id they recorded.");
    unreachable.push("Extensions and scripts that hold a model id are not rewritten.");
  }
  return { candidates: [...selected], changes, unreachable };
}

function candidatesNamedByChanges(
  candidates: readonly Candidate[],
  changes: readonly modelUpgradeTypes.ModelReferenceChange[],
): Candidate[] {
  const named = new Set<string>();
  for (const change of changes) {
    const { base } = splitThinkingSuffix(change.from);
    named.add(base.toLowerCase());
    const slash = base.indexOf("/");
    if (slash > 0) named.add(base.slice(slash + 1).toLowerCase());
  }
  return candidates.filter(
    (candidate) =>
      named.has(`${candidate.from.provider}/${candidate.from.id}`.toLowerCase()) ||
      named.has(candidate.from.id.toLowerCase()),
  );
}

function formatModelUpgrade(candidate: Candidate): string {
  const { from, to } = candidate;
  const mark = candidate.confident ? "" : " (candidate)";
  return `${from.provider}/${from.id} → ${to.provider}/${to.id} · ${candidate.reason}${mark}`;
}

const modelUpgrade = {
  candidatesNamedByChanges,
  compareModelVersions,
  createUpgradeReplacements,
  findModelUpgrade,
  findModelUpgrades,
  formatModelUpgrade,
  parseModelIdVersion,
  planModelUpgrades,
  rewriteModelReferencesInSettings,
  upgradeModelReference,
};

export default modelUpgrade;
