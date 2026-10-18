import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "@msa/coding-agent";
import { Console, Effect } from "effect";

const resourceLoader = new DefaultResourceLoader({
  cwd: process.cwd(),
  agentDir: getAgentDir(),
  additionalExtensionPaths: ["./my-logging-extension.ts", "./my-safety-extension.ts"],
  extensionFactories: [
    (msa) => {
      msa.on("agent_start", () => {
        Effect.runSync(Console.log("[Inline Extension] Agent starting"));
      });
    },
  ],
});
await resourceLoader.reload();

const { session } = await createAgentSession({
  resourceLoader,
  sessionManager: SessionManager.inMemory(),
});

try {
  session.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  });

  await session.prompt("List files in the current directory.");
  Effect.runSync(Console.log());
} finally {
  session.dispose();
}
