import extensionSystem from "./migrations/extension-system.ts";
import legacyLayout from "./migrations/legacy-layout.ts";
import providerRenames from "./migrations/provider-renames.ts";

const { migrateExtensionSystem, showDeprecationWarnings } = extensionSystem;
const { migrateRenamedProviders } = providerRenames;
const {
  migrateKeybindingsConfigFile,
  migrateToolsToBin,
  migrateSessionsFromAgentRoot,
  migrateAuthToAuthJson,
} = legacyLayout;

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

const migrations = {
  migrateAuthToAuthJson,
  migrateSessionsFromAgentRoot,
  runMigrations,
  showDeprecationWarnings,
};

export default migrations;
