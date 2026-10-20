import codingAgent from "@msa/coding-agent";
import { Console, Effect } from "effect";

const { SessionManager, SettingsManager, createAgentSession } = codingAgent;

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
  retry: { baseDelayMs: 1000, enabled: true, maxRetries: 5 },
});

void Effect.runPromise(
  Effect.gen(function* () {
    const { session: customSettingsSession } = yield* Effect.promise(() =>
      createAgentSession({
        sessionManager: SessionManager.inMemory(),
        settingsManager,
      }),
    );
    yield* Console.log("Session created with custom settings");
    customSettingsSession.dispose();

    settingsManager.setDefaultThinkingLevel("low");
    yield* Effect.promise(() => settingsManager.flush());

    const settingsErrors = settingsManager.drainErrors();
    if (settingsErrors.length > 0) {
      for (const { scope, error } of settingsErrors) {
        yield* Console.warn(`Warning (${scope} settings): ${error.message}`);
      }
    }

    const inMemorySettings = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
    });

    const { session: testSession } = yield* Effect.promise(() =>
      createAgentSession({
        sessionManager: SessionManager.inMemory(),
        settingsManager: inMemorySettings,
      }),
    );
    yield* Console.log("Test session created with in-memory settings");
    testSession.dispose();
  }),
);
