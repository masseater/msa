import { Console, Effect } from "effect";

import { createAgentSession, SessionManager } from "@msa/coding-agent";


const { session: readOnlySession } = await createAgentSession({
  tools: ["read", "grep", "find", "ls"],
  sessionManager: SessionManager.inMemory(),
});
Effect.runSync(Console.log("Read-only session created"));
readOnlySession.dispose();


const { session: customToolsSession } = await createAgentSession({
  tools: ["read", "bash", "grep"],
  sessionManager: SessionManager.inMemory(),
});
Effect.runSync(Console.log("Custom tools session created"));
customToolsSession.dispose();


const customCwd = "/path/to/project";
const { session: customCwdSession } = await createAgentSession({
  cwd: customCwd,
  tools: ["read", "bash", "edit", "write"],
  sessionManager: SessionManager.inMemory(customCwd),
});
Effect.runSync(Console.log("Custom cwd session created"));
customCwdSession.dispose();


const { session: specificToolsSession } = await createAgentSession({
  cwd: customCwd,
  tools: ["read", "bash", "grep"],
  sessionManager: SessionManager.inMemory(customCwd),
});
Effect.runSync(Console.log("Specific tools with custom cwd session created"));
specificToolsSession.dispose();
