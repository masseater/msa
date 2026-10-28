import configModule from "../config.ts";
import platformModule from "../core/platform/index.ts";
import text from "../utils/text.ts";

const { join } = platformModule;
const { getAgentDir } = configModule;
const { readText, writeFile } = platformModule.files;
const { stripBom } = text;

function renamedProviderId(id: string): string | undefined {
  if (id === "anthropic") return "anthropic-api";
  if (id === "claude-code" || id.startsWith("claude-code-")) return `claude-subs${id.slice(11)}`;
  return undefined;
}

function renameProviderRef(value: string): string {
  const slash = value.indexOf("/");
  const provider = slash < 0 ? value : value.slice(0, slash);
  const renamed = renamedProviderId(provider);
  return renamed === undefined ? value : renamed + value.slice(provider.length);
}

function renameProviderRefsIn(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(renameProviderRefsIn);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key.includes("/") ? renameProviderRef(key) : key,
        renameProviderRefsIn(entry),
      ]),
    );
  }
  return typeof value === "string" && value.includes("/") ? renameProviderRef(value) : value;
}

type JsonRecord = Record<string, unknown>;

function renameKeys(record: JsonRecord): JsonRecord | undefined {
  const next = new Map(Object.entries(record));
  let changed = false;
  for (const [key, value] of Object.entries(record)) {
    const renamed = renamedProviderId(key);
    if (renamed === undefined) continue;
    if (!next.has(renamed)) next.set(renamed, value);
    next.delete(key);
    changed = true;
  }
  return changed ? Object.fromEntries(next) : undefined;
}

function rewriteJson(path: string, update: (data: JsonRecord) => JsonRecord | undefined) {
  return readText(path)
    .then((content) => {
      const updated = update(JSON.parse(stripBom(content)) as JsonRecord);
      return updated === undefined
        ? undefined
        : writeFile({ data: `${JSON.stringify(updated, null, 2)}\n`, path });
    })
    .catch(() => undefined);
}

function migrateRenamedProviders(agentDir: string = getAgentDir()): Promise<void> {
  return Promise.all([
    rewriteJson(join(agentDir, "auth.json"), renameAuthProviders),
    rewriteJson(join(agentDir, "models.json"), renameModelProviders),
    rewriteJson(join(agentDir, "settings.json"), renameSettingsProviders),
  ]).then(() => undefined);
}

function renameAuthProviders(data: JsonRecord): JsonRecord | undefined {
  const anthropicOAuth = (data["anthropic"] as { type?: unknown } | undefined)?.type === "oauth";
  const kept = anthropicOAuth
    ? Object.fromEntries(Object.entries(data).filter(([key]) => key !== "anthropic"))
    : data;
  return renameKeys(kept) ?? (anthropicOAuth ? kept : undefined);
}

function renameModelProviders(data: JsonRecord): JsonRecord | undefined {
  if (data["providers"] === null || typeof data["providers"] !== "object") return undefined;
  const providers = renameKeys(data["providers"] as JsonRecord);
  return providers === undefined ? undefined : { ...data, providers };
}

function renameSettingsProviders(data: JsonRecord): JsonRecord | undefined {
  const renamed = renameProviderRefsIn(data) as JsonRecord;
  const provider = renamed["defaultProvider"];
  const next =
    typeof provider === "string"
      ? { ...renamed, defaultProvider: renamedProviderId(provider) ?? provider }
      : renamed;
  return JSON.stringify(next) === JSON.stringify(data) ? undefined : next;
}

const providerRenames = { migrateRenamedProviders };

export default providerRenames;
