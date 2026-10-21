import testing from "@msa/testing";

import SessionManager from "../../../src/core/session-manager.ts";
import type sessionManagerTypes from "../../../src/core/session-manager.types.ts";
import SettingsManager from "../../../src/core/settings-manager.ts";
import type settingsManagerTypes from "../../../src/core/settings-manager.types.ts";
const { joinPath } = testing;

function createSessionManager(
  sessionManager: sessionManagerTypes.SessionManager | undefined,
): sessionManagerTypes.SessionManager {
  return sessionManager ?? SessionManager.inMemory();
}

function createSettingsManager(entry: {
  tempDir: string;
  settings: Partial<settingsManagerTypes.Settings> | undefined;
}): settingsManagerTypes.SettingsManager {
  return SettingsManager.inMemory({
    memory: { database: joinPath(entry.tempDir, "memory.db"), embedding: { enabled: false } },
    ...entry.settings,
  });
}

const state = {
  createSessionManager,
  createSettingsManager,
};

export default state;
