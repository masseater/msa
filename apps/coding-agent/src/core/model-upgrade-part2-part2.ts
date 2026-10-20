import modelUpgradePart2Part1 from "./model-upgrade-part2-part1.ts";
import type modelUpgradeTypes from "./model-upgrade.types.ts";

const { rewriteString, rewriteStringArray, upgradeModelReference } = modelUpgradePart2Part1;

function rewriteRecordKeys(
  settings: Record<string, unknown>,
  key: string,
  rewrite: (value: string) => string | undefined,
  changes: modelUpgradeTypes.ModelReferenceChange[],
  path = `${key} key`,
): void {
  const current = settings[key];
  if (typeof current !== "object" || current === null || Array.isArray(current)) return;
  const entries = Object.entries(current as Record<string, unknown>);
  const next: Record<string, unknown> = {};
  let changed = false;
  for (const [entryKey, value] of entries) {
    const replacement = rewrite(entryKey);
    const target = replacement === undefined || replacement === entryKey ? entryKey : replacement;
    if (target !== entryKey) {
      changed = true;
      changes.push({ from: entryKey, setting: path, to: target });
    }
    next[target] = value;
  }
  if (changed) settings[key] = next;
}

function rewriteModelReferencesInSettingsPart1(
  record: Record<string, unknown>,
  replacements: ReadonlyMap<string, string>,
  changes: modelUpgradeTypes.ModelReferenceChange[],
) {
  const provider =
    typeof record["defaultProvider"] === "string" ? record["defaultProvider"] : undefined;
  const rewrite = (value: string): string | undefined =>
    upgradeModelReference(value, replacements, { provider });
  const rewriteQualified = (value: string): string | undefined =>
    upgradeModelReference(value, replacements);

  rewriteString(record, "defaultModel", rewrite, changes);
  rewriteStringArray(record, "enabledModels", rewriteQualified, changes);
  rewriteRecordKeys(record, "modelThinkingLevels", rewriteQualified, changes);

  const compaction = record["compaction"];
  if (typeof compaction === "object" && compaction !== null && !Array.isArray(compaction)) {
    const compactionRecord = compaction as Record<string, unknown>;
    rewriteRecordKeys(
      compactionRecord,
      "modelOverrides",
      rewriteQualified,
      changes,
      "compaction.modelOverrides key",
    );
  }
  return rewriteQualified;
}

const modelUpgradePart2Part2 = {
  rewriteModelReferencesInSettingsPart1,
};

export default modelUpgradePart2Part2;
