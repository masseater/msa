import openBrowserModule from "../../utils/open-browser.ts";
import mcpSignInStorage from "../mcp-sign-in-storage.ts";
import ProjectTrustStore from "../project-trust-store.ts";
import SettingsManager from "../settings-manager.ts";
import type settingsManagerTypes from "../settings-manager.types.ts";
import legacyMigration from "./legacy-migration.ts";
import MemoryService from "./memory-service.ts";
import memoryModule from "./memory.ts";
import type memoryTypes from "./memory.types.ts";
import SepiaceClient from "./sepiace-client.ts";

const { openBrowser } = openBrowserModule;
const { legacyDatabasePath } = legacyMigration;
const { resolveMemorySettings, sepiaceUrl } = memoryModule;
const { signInsNotSaved } = mcpSignInStorage;

function createMemoryService(input: {
  readonly agentDir: string;
  readonly cwd: string;
  readonly settingsManager: settingsManagerTypes.SettingsManager;
  readonly connection?: memoryTypes.MemoryConnectionOptions | undefined;
}): MemoryService {
  const { agentDir, connection, cwd, settingsManager } = input;
  const url = sepiaceUrl(settingsManager.getGlobalSettings());
  return new MemoryService({
    agentDir,
    client: new SepiaceClient({ agentDir, credentials: connection?.credentials, cwd, url }),
    cwd,
    legacyDatabase: legacyDatabasePath(agentDir, settingsManager.getSettings()),
    openUrl: connection?.openUrl ?? openBrowser,
    settings: () => resolveMemorySettings(settingsManager.getSettings()),
    signInSaved: () => signInsNotSaved(agentDir) === undefined,
  });
}

function openMemoryService(
  agentDir: string,
  cwd: string,
  connection?: memoryTypes.MemoryConnectionOptions,
): Promise<MemoryService> {
  return new ProjectTrustStore(agentDir)
    .get(cwd)
    .then((trusted) => SettingsManager.create(cwd, agentDir, { projectTrusted: trusted === true }))
    .then((settingsManager) => createMemoryService({ agentDir, connection, cwd, settingsManager }));
}

const memoryServiceFactory = { createMemoryService, openMemoryService };

export default memoryServiceFactory;
