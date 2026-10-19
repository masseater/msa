import type { Api, Model } from "@msa/ai";

import type { Settings } from "./settings-schema.ts";

export interface ModelIdVersion {
  family: string;

  version: number[];

  variant: string;

  date: string | undefined;
}

const VERSION_PATTERN = /(?<![A-Za-z0-9.])v?(\d{1,2}(?![0-9])(?:[.-]\d{1,2}(?![0-9]))*)/;
const DATE_PATTERN = /^\d{4,8}$/;
const TOKEN_SEPARATOR = /[-_.\s]+/;

export function parseModelIdVersion(id: string): ModelIdVersion | undefined {
  const match = VERSION_PATTERN.exec(id);
  if (!match) return undefined;
  const family = id
    .slice(0, match.index)
    .replace(/[-_.\s]+$/, "")
    .toLowerCase();
  const version = match[1]!.split(/[.-]/).map(Number);
  if (!family || version.some((part) => Number.isNaN(part))) return undefined;
  const tokens = id
    .slice(match.index + match[0].length)
    .split(TOKEN_SEPARATOR)
    .filter(Boolean);
  const last = tokens[tokens.length - 1];
  const date = last !== undefined && DATE_PATTERN.test(last) ? tokens.pop() : undefined;
  return {
    family,
    version,
    variant: tokens.join("-").toLowerCase(),
    date: date?.toLowerCase(),
  };
}

export function compareModelVersions(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left - right;
  }
  return 0;
}

function compareDates(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;

  if (a === undefined) return -1;
  if (b === undefined) return 1;
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : 1;
}

export interface ModelUpgradeCandidate {
  from: Model<Api>;
  to: Model<Api>;

  confident: boolean;

  reason: string;
}

function describeReason(from: ModelIdVersion, to: ModelIdVersion): string {
  const versionChange = compareModelVersions(from.version, to.version);
  if (versionChange < 0) {
    return `version ${from.version.join(".")} to ${to.version.join(".")}`;
  }
  if (versionChange > 0) {
    return `version ${from.version.join(".")} is newer than ${to.version.join(".")}`;
  }
  if (from.date === undefined && to.date !== undefined) {
    return `dated variant ${to.date}`;
  }
  return `dated variant ${from.date ?? "none"} to ${to.date ?? "none"}`;
}

function familyKey(model: Model<Api>, parsed: ModelIdVersion): string {
  return [model.provider, parsed.family, parsed.variant].join("\u0000");
}

export function findModelUpgrades(models: readonly Model<Api>[]): ModelUpgradeCandidate[] {
  const parsed = new Map<Model<Api>, ModelIdVersion>();
  for (const model of models) {
    const version = parseModelIdVersion(model.id);
    if (version) parsed.set(model, version);
  }

  const byFamily = new Map<string, Model<Api>[]>();
  const byFamilyWithoutVariant = new Map<string, Model<Api>[]>();
  for (const [model, version] of parsed) {
    const key = familyKey(model, version);
    byFamily.set(key, [...(byFamily.get(key) ?? []), model]);
    const loose = [model.provider, version.family].join("\u0000");
    byFamilyWithoutVariant.set(loose, [...(byFamilyWithoutVariant.get(loose) ?? []), model]);
  }

  const newestFirst = (a: Model<Api>, b: Model<Api>): number => {
    const left = parsed.get(a)!;
    const right = parsed.get(b)!;
    return compareModelVersions(right.version, left.version) || compareDates(right.date, left.date);
  };

  const reference = (model: Model<Api>): string => `${model.provider}/${model.id}`;
  const candidates: ModelUpgradeCandidate[] = [];
  const reported = new Set<string>();
  for (const family of byFamily.values()) {
    const ordered = [...family].sort(newestFirst);
    const newest = ordered[0]!;
    const newestVersion = parsed.get(newest)!;
    for (const model of ordered.slice(1)) {
      const version = parsed.get(model)!;
      candidates.push({
        from: model,
        to: newest,
        confident: true,
        reason: describeReason(version, newestVersion),
      });
      reported.add(reference(model));
    }
  }

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
        from: model,
        to: newest,
        confident: false,
        reason: `${describeReason(version, newestVersion)}; variant ${version.variant || "none"} to ${newestVersion.variant || "none"}`,
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

export function findModelUpgrade(
  candidates: readonly ModelUpgradeCandidate[],
  reference: string,
): ModelUpgradeCandidate | undefined {
  const text = reference.trim().toLowerCase();
  return candidates.find(
    (candidate) =>
      `${candidate.from.provider}/${candidate.from.id}`.toLowerCase() === text ||
      candidate.from.id.toLowerCase() === text,
  );
}

export function createUpgradeReplacements(
  candidates: readonly ModelUpgradeCandidate[],
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

export function upgradeModelReference(
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

export interface ModelReferenceChange {
  setting: string;
  from: string;
  to: string;
}

function rewriteString(
  settings: Record<string, unknown>,
  key: string,
  rewrite: (value: string) => string | undefined,
  changes: ModelReferenceChange[],
  path = key,
): void {
  const current = settings[key];
  if (typeof current !== "string") return;
  const next = rewrite(current);
  if (next === undefined || next === current) return;
  settings[key] = next;
  changes.push({ setting: path, from: current, to: next });
}

function rewriteStringArray(
  settings: Record<string, unknown>,
  key: string,
  rewrite: (value: string) => string | undefined,
  changes: ModelReferenceChange[],
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
    changes.push({ setting: path, from: entry, to: replacement });
    return replacement;
  });
  if (changed) settings[key] = next;
}

function rewriteRecordKeys(
  settings: Record<string, unknown>,
  key: string,
  rewrite: (value: string) => string | undefined,
  changes: ModelReferenceChange[],
  path = `${key} key`,
): void {
  const current = settings[key];
  if (!current || typeof current !== "object" || Array.isArray(current)) return;
  const entries = Object.entries(current as Record<string, unknown>);
  const next: Record<string, unknown> = {};
  let changed = false;
  for (const [entryKey, value] of entries) {
    const replacement = rewrite(entryKey);
    const target = replacement === undefined || replacement === entryKey ? entryKey : replacement;
    if (target !== entryKey) {
      changed = true;
      changes.push({ setting: path, from: entryKey, to: target });
    }
    next[target] = value;
  }
  if (changed) settings[key] = next;
}

export function rewriteModelReferencesInSettings(
  settings: Settings,
  replacements: ReadonlyMap<string, string>,
): ModelReferenceChange[] {
  if (replacements.size === 0) return [];
  const changes: ModelReferenceChange[] = [];
  const record = settings as unknown as Record<string, unknown>;
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
  if (compaction && typeof compaction === "object" && !Array.isArray(compaction)) {
    const compactionRecord = compaction as Record<string, unknown>;
    rewriteRecordKeys(
      compactionRecord,
      "modelOverrides",
      rewriteQualified,
      changes,
      "compaction.modelOverrides key",
    );
  }

  const policy = record["modelPolicy"];
  if (policy && typeof policy === "object" && !Array.isArray(policy)) {
    const policyRecord = policy as Record<string, unknown>;
    rewriteStringArray(policyRecord, "allow", rewriteQualified, changes, "modelPolicy.allow[]");
    rewriteStringArray(policyRecord, "deny", rewriteQualified, changes, "modelPolicy.deny[]");
  }

  const goal = record["goal"];
  if (goal && typeof goal === "object" && !Array.isArray(goal)) {
    rewriteString(
      goal as Record<string, unknown>,
      "evaluatorModel",
      rewriteQualified,
      changes,
      "goal.evaluatorModel",
    );
  }
  const orchestrator = record["orchestrator"];
  if (orchestrator && typeof orchestrator === "object" && !Array.isArray(orchestrator)) {
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

export interface ModelUpgradePlan {
  candidates: ModelUpgradeCandidate[];
  changes: Array<ModelReferenceChange & { scope: "global" | "project" }>;

  unreachable: string[];
}

export function planModelUpgrades(options: {
  candidates: readonly ModelUpgradeCandidate[];
  layers: { global: Settings; project: Settings };
  selected?: readonly ModelUpgradeCandidate[];
}): ModelUpgradePlan {
  const selected = options.selected ?? options.candidates;
  const replacements = createUpgradeReplacements(selected);
  const changes: ModelUpgradePlan["changes"] = [];
  for (const scope of ["global", "project"] as const) {
    const layer = structuredClone(options.layers[scope]) as Settings;
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

export function candidatesNamedByChanges(
  candidates: readonly ModelUpgradeCandidate[],
  changes: readonly ModelReferenceChange[],
): ModelUpgradeCandidate[] {
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

export function formatModelUpgrade(candidate: ModelUpgradeCandidate): string {
  const { from, to } = candidate;
  const mark = candidate.confident ? "" : " (candidate)";
  return `${from.provider}/${from.id} → ${to.provider}/${to.id} · ${candidate.reason}${mark}`;
}
