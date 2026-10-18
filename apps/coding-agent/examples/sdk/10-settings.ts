import { Console, Effect } from "effect";

import { createAgentSession, SessionManager, SettingsManager } from "@msa/coding-agent";

const cwd = process.cwd();


const settingsManagerFromDisk = SettingsManager.create(cwd);
Effect.runSync(
  Console.log(
    "Current settings:",
    JSON.stringify(settingsManagerFromDisk.getGlobalSettings(), null, 2),
  ),
);


const settingsManager = SettingsManager.create(cwd);
settingsManager.applyOverrides({
  compaction: { enabled: false },
  retry: { enabled: true, maxRetries: 5, baseDelayMs: 1000 },
});

const { session: customSettingsSession } = await createAgentSession({
  settingsManager,
  sessionManager: SessionManager.inMemory(),
});
Effect.runSync(Console.log("Session created with custom settings"));
customSettingsSession.dispose();



settingsManager.setDefaultThinkingLevel("low");
await settingsManager.flush();


const settingsErrors = settingsManager.drainErrors();
if (settingsErrors.length > 0) {
  for (const { scope, error } of settingsErrors) {
    Effect.runSync(Console.warn(`Warning (${scope} settings): ${error.message}`));
  }
}


const inMemorySettings = SettingsManager.inMemory({
  compaction: { enabled: false },
  retry: { enabled: false },
});

const { session: testSession } = await createAgentSession({
  settingsManager: inMemorySettings,
  sessionManager: SessionManager.inMemory(),
});
Effect.runSync(Console.log("Test session created with in-memory settings"));
testSession.dispose();
