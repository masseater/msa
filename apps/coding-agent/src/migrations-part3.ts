import configModule from "./config.ts";
import platformNode from "./core/platform-node.ts";
import migrationsPart1 from "./migrations-part1.ts";
import migrationsPart2 from "./migrations-part2.ts";

const { getAgentDir } = configModule;
const { join } = platformNode;
const { renameKeys, renameProviderRefsIn, renamedProviderId, rewriteJson } = migrationsPart2;
const {
  migrateAuthToAuthJson,
  migrateExtensionSystem,
  migrateKeybindingsConfigFile,
  migrateSessionsFromAgentRoot,
  migrateToolsToBin,
} = migrationsPart1;

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

function runMigrations(cwd: string): {
  migratedAuthProviders: string[];
  deprecationWarnings: string[];
} {
  const migratedAuthProviders = migrateAuthToAuthJson();
  migrateSessionsFromAgentRoot();
  migrateToolsToBin();
  migrateKeybindingsConfigFile();
  migrateRenamedProviders();
  const deprecationWarnings = migrateExtensionSystem(cwd);
  return { deprecationWarnings, migratedAuthProviders };
}

const migrationsPart3 = {
  runMigrations,
};

export default migrationsPart3;
