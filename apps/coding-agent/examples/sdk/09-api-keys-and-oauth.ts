import { createAgentSession, ModelRuntime, SessionManager } from "@msa/coding-agent";
import { Console, Effect } from "effect";

const modelRuntime = await ModelRuntime.create();
const { session: defaultAuthSession } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  modelRuntime,
});
Effect.runSync(Console.log("Session with default model runtime"));
defaultAuthSession.dispose();

const customRuntime = await ModelRuntime.create({
  authPath: "/tmp/my-app/auth.json",
  modelsPath: "/tmp/my-app/models.json",
});
const { session: customAuthSession } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  modelRuntime: customRuntime,
});
Effect.runSync(Console.log("Session with custom auth and models locations"));
customAuthSession.dispose();

await modelRuntime.setRuntimeApiKey("anthropic", "sk-my-temp-key");
const { session: runtimeKeySession } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  modelRuntime,
});
Effect.runSync(Console.log("Session with runtime API key override"));
runtimeKeySession.dispose();
