import configModule from "./config.ts";
import extensionSystem from "./migrations/extension-system.ts";
import legacyLayout from "./migrations/legacy-layout.ts";
import providerRenames from "./migrations/provider-renames.ts";

const { getAgentDir, getBinDir } = configModule;
const { migrateExtensionSystem, showDeprecationWarnings } = extensionSystem;
const { migrateRenamedProviders } = providerRenames;
const {
  migrateKeybindingsConfigFile,
  migrateToolsToBin,
  migrateSessionsFromAgentRoot,
  migrateAuthToAuthJson,
} = legacyLayout;

function runMigrations(cwd: string): Promise<{
  migratedAuthProviders: string[];
  deprecationWarnings: string[];
}> {
  const agentDir = getAgentDir();
  const binDir = getBinDir();
  return migrateAuthToAuthJson(agentDir).then((migratedAuthProviders) =>
    migrateSessionsFromAgentRoot(agentDir)
      .then(() => migrateToolsToBin(agentDir, binDir))
      .then(() => migrateKeybindingsConfigFile(agentDir))
      .then(() => migrateRenamedProviders(agentDir))
      .then(() => migrateExtensionSystem(cwd, agentDir))
      .then((deprecationWarnings) => ({ deprecationWarnings, migratedAuthProviders })),
  );
}

const migrations = {
  migrateAuthToAuthJson,
  migrateSessionsFromAgentRoot,
  runMigrations,
  showDeprecationWarnings,
};

export default migrations;
