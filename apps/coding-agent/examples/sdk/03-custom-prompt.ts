import codingAgent from "@msa/coding-agent";
import { Console, Effect } from "effect";

const { DefaultResourceLoader, SessionManager, createAgentSession, getAgentDir } = codingAgent;

const cwd = process.cwd();
const agentDir = getAgentDir();

const loader1 = new DefaultResourceLoader({
  agentDir,
  appendSystemPromptOverride: () => [],
  cwd,
  systemPromptOverride: () => `You are a helpful assistant that speaks like a pirate.
Always end responses with "Arrr!"`,
});

const replacePrompt = Effect.gen(function* () {
  yield* Effect.promise(() => loader1.reload());

  const { session: session1 } = yield* Effect.promise(() =>
    createAgentSession({
      resourceLoader: loader1,
      sessionManager: SessionManager.inMemory(),
    }),
  );

  try {
    session1.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        process.stdout.write(event.assistantMessageEvent.delta);
      }
    });

    yield* Console.log("=== Replace prompt ===");
    yield* Effect.promise(() => session1.prompt("What is 2 + 2?"));
    yield* Console.log("\n");
  } finally {
    session1.dispose();
  }
});

const modifyPrompt = Effect.gen(function* () {
  const loader2 = new DefaultResourceLoader({
    agentDir,
    appendSystemPromptOverride: (base) => [
      ...base,
      "## Additional Instructions\n- Always be concise\n- Use bullet points when listing things",
    ],
    cwd,
  });
  yield* Effect.promise(() => loader2.reload());

  const { session: session2 } = yield* Effect.promise(() =>
    createAgentSession({
      resourceLoader: loader2,
      sessionManager: SessionManager.inMemory(),
    }),
  );

  try {
    session2.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        process.stdout.write(event.assistantMessageEvent.delta);
      }
    });

    yield* Console.log("=== Modify prompt ===");
    yield* Effect.promise(() => session2.prompt("List 3 benefits of TypeScript."));
    yield* Console.log();
  } finally {
    session2.dispose();
  }
});

void Effect.runPromise(Effect.andThen(replacePrompt, modifyPrompt));
