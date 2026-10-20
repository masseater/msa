import { ModelRuntime, SessionManager, createAgentSession } from "@msa/coding-agent";
import { Console, Effect } from "effect";

const modelRuntime = await ModelRuntime.create();
const { session: defaultAuthSession } = await createAgentSession({
  modelRuntime,
  sessionManager: SessionManager.inMemory(),
});
Effect.runSync(Console.log("Session with default model runtime"));
defaultAuthSession.dispose();

const customRuntime = await ModelRuntime.create({
  authPath: "/tmp/my-app/auth.json",
  modelsPath: "/tmp/my-app/models.json",
});
const { session: customAuthSession } = await createAgentSession({
  modelRuntime: customRuntime,
  sessionManager: SessionManager.inMemory(),
});
Effect.runSync(Console.log("Session with custom auth and models locations"));
customAuthSession.dispose();

await modelRuntime.setRuntimeApiKey("anthropic-api", "sk-my-temp-key");
const { session: runtimeKeySession } = await createAgentSession({
  modelRuntime,
  sessionManager: SessionManager.inMemory(),
});
Effect.runSync(Console.log("Session with runtime API key override"));
runtimeKeySession.dispose();
