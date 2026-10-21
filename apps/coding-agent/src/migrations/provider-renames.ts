import configModule from "../config.ts";
import platformModule from "../core/platform/index.ts";
import nodeFs from "../core/platform/node/fs.ts";
import text from "../utils/text.ts";

const { join } = platformModule;
const { getAgentDir } = configModule;
const { writeFileSync, readFileSync, existsSync } = nodeFs;
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

function renameKeys(record: Record<string, unknown>): boolean {
  let changed = false;
  for (const [key, value] of Object.entries(record)) {
    const renamed = renamedProviderId(key);
    if (renamed === undefined) continue;
    if (!(renamed in record)) record[renamed] = value;
    delete record[key];
    changed = true;
  }
  return changed;
}

function rewriteJson(path: string, update: (data: Record<string, unknown>) => boolean): void {
  if (!existsSync(path)) return;
  try {
    const data = JSON.parse(stripBom(readFileSync(path, "utf-8"))) as Record<string, unknown>;
    if (update(data)) writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  } catch {}
}

function migrateRenamedProviders(): void {
  const agentDir = getAgentDir();
  rewriteJson(join(agentDir, "auth.json"), (data) => {
    const anthropic = data["anthropic"] as { type?: unknown } | undefined;
    if (anthropic?.type === "oauth") delete data["anthropic"];
    return renameKeys(data) || anthropic?.type === "oauth";
  });
  rewriteJson(join(agentDir, "models.json"), (data) =>
    data["providers"] !== null && typeof data["providers"] === "object"
      ? renameKeys(data["providers"] as Record<string, unknown>)
      : false,
  );
  rewriteJson(join(agentDir, "settings.json"), (data) => {
    const before = JSON.stringify(data);
    const renamed = renameProviderRefsIn(data) as Record<string, unknown>;
    const provider = renamed["defaultProvider"];
    if (typeof provider === "string")
      renamed["defaultProvider"] = renamedProviderId(provider) ?? provider;
    if (JSON.stringify(renamed) === before) return false;
    for (const key of Object.keys(data)) delete data[key];
    Object.assign(data, renamed);
    return true;
  });
}

const providerRenames = { migrateRenamedProviders };

export default providerRenames;
