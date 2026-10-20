import modelUpgradePart2 from "./model-upgrade-part2.ts";
import type modelUpgradeTypes from "./model-upgrade.types.ts";
import type settingsSchemaTypes from "./settings-schema.types.ts";

const {
  createUpgradeReplacements,
  rewriteModelReferencesInSettingsPart1,
  rewriteString,
  rewriteStringArray,
  splitThinkingSuffix,
} = modelUpgradePart2;

function rewriteModelReferencesInSettings(
  settings: settingsSchemaTypes.Settings,
  replacements: ReadonlyMap<string, string>,
): modelUpgradeTypes.ModelReferenceChange[] {
  if (replacements.size === 0) return [];
  const changes: modelUpgradeTypes.ModelReferenceChange[] = [];
  const record = settings as unknown as Record<string, unknown>;
  const rewriteQualified = rewriteModelReferencesInSettingsPart1(record, replacements, changes);

  const policy = record["modelPolicy"];
  if (typeof policy === "object" && policy !== null && !Array.isArray(policy)) {
    const policyRecord = policy as Record<string, unknown>;
    rewriteStringArray(policyRecord, "allow", rewriteQualified, changes, "modelPolicy.allow[]");
    rewriteStringArray(policyRecord, "deny", rewriteQualified, changes, "modelPolicy.deny[]");
  }

  const goal = record["goal"];
  if (typeof goal === "object" && goal !== null && !Array.isArray(goal)) {
    rewriteString(
      goal as Record<string, unknown>,
      "evaluatorModel",
      rewriteQualified,
      changes,
      "goal.evaluatorModel",
    );
  }
  const orchestrator = record["orchestrator"];
  if (typeof orchestrator === "object" && orchestrator !== null && !Array.isArray(orchestrator)) {
    const orchestratorRecord = orchestrator as Record<string, unknown>;
    rewriteString(
      orchestratorRecord,
      "workerModel",
      rewriteQualified,
      changes,
      "orchestrator.workerModel",
    );
    rewriteString(
      orchestratorRecord,
      "reviewModel",
      rewriteQualified,
      changes,
      "orchestrator.reviewModel",
    );
  }

  return changes;
}

function planModelUpgrades(options: {
  candidates: readonly modelUpgradeTypes.ModelUpgradeCandidate[];
  layers: { global: settingsSchemaTypes.Settings; project: settingsSchemaTypes.Settings };
  selected?: readonly modelUpgradeTypes.ModelUpgradeCandidate[];
}): modelUpgradeTypes.ModelUpgradePlan {
  const selected = options.selected ?? options.candidates;
  const replacements = createUpgradeReplacements(selected);
  const changes: modelUpgradeTypes.ModelUpgradePlan["changes"] = [];
  for (const scope of ["global", "project"] as const) {
    const layer = structuredClone(options.layers[scope]) as settingsSchemaTypes.Settings;
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
  candidates: readonly modelUpgradeTypes.ModelUpgradeCandidate[],
  changes: readonly modelUpgradeTypes.ModelReferenceChange[],
): modelUpgradeTypes.ModelUpgradeCandidate[] {
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

function formatModelUpgrade(candidate: modelUpgradeTypes.ModelUpgradeCandidate): string {
  const { from, to } = candidate;
  const mark = candidate.confident ? "" : " (candidate)";
  return `${from.provider}/${from.id} → ${to.provider}/${to.id} · ${candidate.reason}${mark}`;
}

const modelUpgradePart3 = {
  candidatesNamedByChanges,
  formatModelUpgrade,
  planModelUpgrades,
  rewriteModelReferencesInSettings,
};

export default modelUpgradePart3;
