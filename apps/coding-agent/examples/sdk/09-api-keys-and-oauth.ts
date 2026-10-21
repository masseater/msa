import codingAgent from "@msa/coding-agent";
import { Console, Effect } from "effect";

const { ModelRuntime, SessionManager, createAgentSession } = codingAgent;

void Effect.runPromise(
  Effect.gen(function* () {
    const modelRuntime = yield* Effect.promise(() => ModelRuntime.create());
    const { session: defaultAuthSession } = yield* Effect.promise(() =>
      createAgentSession({
        modelRuntime,
        sessionManager: SessionManager.inMemory(),
      }),
    );
    yield* Console.log("Session with default model runtime");
    defaultAuthSession.dispose();

    const customRuntime = yield* Effect.promise(() =>
      ModelRuntime.create({
        authPath: "/tmp/my-app/auth.json",
        modelsPath: "/tmp/my-app/models.json",
      }),
    );
    const { session: customAuthSession } = yield* Effect.promise(() =>
      createAgentSession({
        modelRuntime: customRuntime,
        sessionManager: SessionManager.inMemory(),
      }),
    );
    yield* Console.log("Session with custom auth and models locations");
    customAuthSession.dispose();

    yield* Effect.promise(() => modelRuntime.setRuntimeApiKey("anthropic-api", "sk-my-temp-key"));
    const { session: runtimeKeySession } = yield* Effect.promise(() =>
      createAgentSession({
        modelRuntime,
        sessionManager: SessionManager.inMemory(),
      }),
    );
    yield* Console.log("Session with runtime API key override");
    runtimeKeySession.dispose();
  }),
);
