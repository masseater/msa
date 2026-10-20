import {
  DefaultResourceLoader,
  SessionManager,
  createAgentSession,
  getAgentDir,
} from "@msa/coding-agent";
import { Console, Effect } from "effect";

const cwd = process.cwd();
const agentDir = getAgentDir();

const loader1 = new DefaultResourceLoader({
  agentDir,
  appendSystemPromptOverride: () => [],
  cwd,
  systemPromptOverride: () => `You are a helpful assistant that speaks like a pirate.
Always end responses with "Arrr!"`,
});
await loader1.reload();

const { session: session1 } = await createAgentSession({
  resourceLoader: loader1,
  sessionManager: SessionManager.inMemory(),
});

try {
  session1.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  });

  Effect.runSync(Console.log("=== Replace prompt ==="));
  await session1.prompt("What is 2 + 2?");
  Effect.runSync(Console.log("\n"));
} finally {
  session1.dispose();
}

const loader2 = new DefaultResourceLoader({
  agentDir,
  appendSystemPromptOverride: (base) => [
    ...base,
    "## Additional Instructions\n- Always be concise\n- Use bullet points when listing things",
  ],
  cwd,
});
await loader2.reload();

const { session: session2 } = await createAgentSession({
  resourceLoader: loader2,
  sessionManager: SessionManager.inMemory(),
});

try {
  session2.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  });

  Effect.runSync(Console.log("=== Modify prompt ==="));
  await session2.prompt("List 3 benefits of TypeScript.");
  Effect.runSync(Console.log());
} finally {
  session2.dispose();
}
