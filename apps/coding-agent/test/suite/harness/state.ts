import SessionManager from "../../../src/core/session-manager.ts";
import type sessionManagerTypes from "../../../src/core/session-manager.types.ts";
import SettingsManager from "../../../src/core/settings-manager.ts";
import type settingsManagerTypes from "../../../src/core/settings-manager.types.ts";

function createSessionManager(
  sessionManager: sessionManagerTypes.SessionManager | undefined,
): sessionManagerTypes.SessionManager {
  return sessionManager ?? SessionManager.inMemory();
}

function createSettingsManager(
  settings: Partial<settingsManagerTypes.Settings> | undefined,
): settingsManagerTypes.SettingsManager {
  return SettingsManager.inMemory(settings);
}

const state = {
  createSessionManager,
  createSettingsManager,
};

export default state;
