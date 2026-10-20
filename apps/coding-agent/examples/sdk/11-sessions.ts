import codingAgent from "@msa/coding-agent";
import { Console, Effect } from "effect";

const { SessionManager, createAgentSession } = codingAgent;

void Effect.runPromise(
  Effect.gen(function* () {
    const { session: inMemory } = yield* Effect.promise(() =>
      createAgentSession({
        sessionManager: SessionManager.inMemory(),
      }),
    );
    yield* Console.log("In-memory session:", inMemory.sessionFile ?? "(none)");
    inMemory.dispose();

    const { session: newSession } = yield* Effect.promise(() =>
      createAgentSession({
        sessionManager: SessionManager.create(process.cwd()),
      }),
    );
    yield* Console.log("New session file:", newSession.sessionFile);
    newSession.dispose();

    const { session: continued, modelFallbackMessage } = yield* Effect.promise(() =>
      createAgentSession({
        sessionManager: SessionManager.continueRecent(process.cwd()),
      }),
    );
    if (modelFallbackMessage !== undefined) yield* Console.log("Note:", modelFallbackMessage);
    yield* Console.log("Continued session:", continued.sessionFile);
    continued.dispose();

    const sessions = yield* Effect.promise(() => SessionManager.list(process.cwd()));
    yield* Console.log(`\nFound ${sessions.length} sessions:`);
    for (const info of sessions.slice(0, 3)) {
      yield* Console.log(`  ${info.id.slice(0, 8)}... - "${info.firstMessage.slice(0, 30)}..."`);
    }

    const [latestSession] = sessions;
    if (latestSession !== undefined) {
      const { session: opened } = yield* Effect.promise(() =>
        createAgentSession({
          sessionManager: SessionManager.open(latestSession.path),
        }),
      );
      yield* Console.log(`\nOpened: ${opened.sessionId}`);
      opened.dispose();
    }
  }),
);
