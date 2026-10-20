import { SessionManager, createAgentSession } from "@msa/coding-agent";
import { Console, Effect } from "effect";

const { session: readOnlySession } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  tools: ["read", "grep", "find", "ls"],
});
Effect.runSync(Console.log("Read-only session created"));
readOnlySession.dispose();

const { session: customToolsSession } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  tools: ["read", "bash", "grep"],
});
Effect.runSync(Console.log("Custom tools session created"));
customToolsSession.dispose();

const customCwd = "/path/to/project";
const { session: customCwdSession } = await createAgentSession({
  cwd: customCwd,
  sessionManager: SessionManager.inMemory(customCwd),
  tools: ["read", "bash", "edit", "write"],
});
Effect.runSync(Console.log("Custom cwd session created"));
customCwdSession.dispose();

const { session: specificToolsSession } = await createAgentSession({
  cwd: customCwd,
  sessionManager: SessionManager.inMemory(customCwd),
  tools: ["read", "bash", "grep"],
});
Effect.runSync(Console.log("Specific tools with custom cwd session created"));
specificToolsSession.dispose();
