import codingAgent from "@msa/coding-agent";
import { Console, Effect } from "effect";

const { SessionManager, createAgentSession } = codingAgent;

void Effect.runPromise(
  Effect.gen(function* () {
    const { session: readOnlySession } = yield* Effect.promise(() =>
      createAgentSession({
        sessionManager: SessionManager.inMemory(),
        tools: ["read", "grep", "find", "ls"],
      }),
    );
    yield* Console.log("Read-only session created");
    readOnlySession.dispose();

    const { session: customToolsSession } = yield* Effect.promise(() =>
      createAgentSession({
        sessionManager: SessionManager.inMemory(),
        tools: ["read", "bash", "grep"],
      }),
    );
    yield* Console.log("Custom tools session created");
    customToolsSession.dispose();

    const customCwd = "/path/to/project";
    const { session: customCwdSession } = yield* Effect.promise(() =>
      createAgentSession({
        cwd: customCwd,
        sessionManager: SessionManager.inMemory(customCwd),
        tools: ["read", "bash", "edit", "write"],
      }),
    );
    yield* Console.log("Custom cwd session created");
    customCwdSession.dispose();

    const { session: specificToolsSession } = yield* Effect.promise(() =>
      createAgentSession({
        cwd: customCwd,
        sessionManager: SessionManager.inMemory(customCwd),
        tools: ["read", "bash", "grep"],
      }),
    );
    yield* Console.log("Specific tools with custom cwd session created");
    specificToolsSession.dispose();
  }),
);
