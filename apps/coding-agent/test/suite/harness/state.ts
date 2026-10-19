import { joinPath } from "@msa/testing";

import { SessionManager } from "../../../src/core/session-manager.ts";
import { SettingsManager } from "../../../src/core/settings-manager.ts";
import type { Settings } from "../../../src/core/settings-manager.ts";

export function createSessionManager(sessionManager: SessionManager | undefined): SessionManager {
  return sessionManager ?? SessionManager.inMemory();
}

export function createSettingsManager(entry: {
  tempDir: string;
  settings: Partial<Settings> | undefined;
}): SettingsManager {
  return SettingsManager.inMemory({
    memory: { database: joinPath(entry.tempDir, "memory.db"), embedding: { enabled: false } },
    ...entry.settings,
  });
}
