import { Console, Effect } from "effect";

import { createAgentSession, SessionManager } from "@msa/coding-agent";


const { session: inMemory } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
});
Effect.runSync(Console.log("In-memory session:", inMemory.sessionFile ?? "(none)"));
inMemory.dispose();


const { session: newSession } = await createAgentSession({
  sessionManager: SessionManager.create(process.cwd()),
});
Effect.runSync(Console.log("New session file:", newSession.sessionFile));
newSession.dispose();


const { session: continued, modelFallbackMessage } = await createAgentSession({
  sessionManager: SessionManager.continueRecent(process.cwd()),
});
if (modelFallbackMessage !== undefined) Effect.runSync(Console.log("Note:", modelFallbackMessage));
Effect.runSync(Console.log("Continued session:", continued.sessionFile));
continued.dispose();


const sessions = await SessionManager.list(process.cwd());
Effect.runSync(Console.log(`\nFound ${sessions.length} sessions:`));
for (const info of sessions.slice(0, 3)) {
  Effect.runSync(Console.log(`  ${info.id.slice(0, 8)}... - "${info.firstMessage.slice(0, 30)}..."`));
}

const [latestSession] = sessions;
if (latestSession !== undefined) {
  const { session: opened } = await createAgentSession({
    sessionManager: SessionManager.open(latestSession.path),
  });
  Effect.runSync(Console.log(`\nOpened: ${opened.sessionId}`));
  opened.dispose();
}








