import type modelUpgradeTypes from "../model-upgrade.types.ts";
import type settingsSchemaTypes from "../settings-schema.types.ts";

type Change = modelUpgradeTypes.ModelReferenceChange;
type Rewrite = (value: string) => string | undefined;
type SettingsRecord = Record<string, unknown>;

const KEY_SEPARATOR = "\u0000";

function splitThinkingSuffix(reference: string): { base: string; suffix: string } {
  const colon = reference.lastIndexOf(":");
  if (colon === -1) return { base: reference, suffix: "" };
  return { base: reference.slice(0, colon), suffix: reference.slice(colon) };
}

function soleProviderFor(base: string, replacements: ReadonlyMap<string, string>) {
  const providers = [...replacements.keys()]
    .filter((key) => key.slice(key.indexOf(KEY_SEPARATOR) + 1) === base)
    .map((key) => key.slice(0, key.indexOf(KEY_SEPARATOR)));
  return providers.length === 1 ? providers[0] : undefined;
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
    const replacement = replacements.get([provider, base.slice(slash + 1)].join(KEY_SEPARATOR));
    return replacement === undefined ? undefined : `${provider}/${replacement}${suffix}`;
  }
  const provider = options.provider ?? soleProviderFor(base, replacements);
  if (provider === undefined) return undefined;
  const replacement = replacements.get([provider, base].join(KEY_SEPARATOR));
  return replacement === undefined ? undefined : `${replacement}${suffix}`;
}

function rewriteString(
  settings: SettingsRecord,
  key: string,
  rewrite: Rewrite,
  changes: Change[],
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
  settings: SettingsRecord,
  key: string,
  rewrite: Rewrite,
  changes: Change[],
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

function rewriteRecordKeys(
  settings: SettingsRecord,
  key: string,
  rewrite: Rewrite,
  changes: Change[],
  path = `${key} key`,
): void {
  const current = settings[key];
  if (!isRecord(current)) return;
  const next: SettingsRecord = {};
  let changed = false;
  for (const [entryKey, value] of Object.entries(current)) {
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

function isRecord(value: unknown): value is SettingsRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rewriteSections(record: SettingsRecord, rewrite: Rewrite, changes: Change[]): void {
  const { compaction, goal, modelPolicy, orchestrator } = record;
  if (isRecord(compaction)) {
    rewriteRecordKeys(
      compaction,
      "modelOverrides",
      rewrite,
      changes,
      "compaction.modelOverrides key",
    );
  }
  if (isRecord(modelPolicy)) {
    rewriteStringArray(modelPolicy, "allow", rewrite, changes, "modelPolicy.allow[]");
    rewriteStringArray(modelPolicy, "deny", rewrite, changes, "modelPolicy.deny[]");
  }
  if (isRecord(goal)) {
    rewriteString(goal, "evaluatorModel", rewrite, changes, "goal.evaluatorModel");
  }
  if (isRecord(orchestrator)) {
    rewriteString(orchestrator, "workerModel", rewrite, changes, "orchestrator.workerModel");
    rewriteString(orchestrator, "reviewModel", rewrite, changes, "orchestrator.reviewModel");
  }
}

function rewriteModelReferencesInSettings(
  settings: settingsSchemaTypes.Settings,
  replacements: ReadonlyMap<string, string>,
): Change[] {
  if (replacements.size === 0) return [];
  const changes: Change[] = [];
  const record = settings as unknown as SettingsRecord;
  const defaultProvider = record["defaultProvider"];
  const provider = typeof defaultProvider === "string" ? defaultProvider : undefined;
  const qualified: Rewrite = (value) => upgradeModelReference(value, replacements);

  rewriteString(
    record,
    "defaultModel",
    (value) => upgradeModelReference(value, replacements, { provider }),
    changes,
  );
  rewriteStringArray(record, "enabledModels", qualified, changes);
  rewriteRecordKeys(record, "modelThinkingLevels", qualified, changes);
  rewriteSections(record, qualified, changes);
  return changes;
}

const modelReferences = {
  rewriteModelReferencesInSettings,
  splitThinkingSuffix,
  upgradeModelReference,
};

export default modelReferences;
