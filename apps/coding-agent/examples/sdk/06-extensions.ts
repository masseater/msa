import codingAgent from "@msa/coding-agent";
import { Console, Effect } from "effect";

const { DefaultResourceLoader, SessionManager, createAgentSession, getAgentDir } = codingAgent;

const resourceLoader = new DefaultResourceLoader({
  additionalExtensionPaths: ["./my-logging-extension.ts", "./my-safety-extension.ts"],
  agentDir: getAgentDir(),
  cwd: process.cwd(),
  extensionFactories: [
    (msa) => {
      msa.on("agent_start", () => {
        Effect.runSync(Console.log("[Inline Extension] Agent starting"));
      });
    },
  ],
});

void Effect.runPromise(
  Effect.gen(function* () {
    yield* Effect.promise(() => resourceLoader.reload());

    const { session } = yield* Effect.promise(() =>
      createAgentSession({
        resourceLoader,
        sessionManager: SessionManager.inMemory(),
      }),
    );

    try {
      session.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          process.stdout.write(event.assistantMessageEvent.delta);
        }
      });

      yield* Effect.promise(() => session.prompt("List files in the current directory."));
      yield* Console.log();
    } finally {
      session.dispose();
    }
  }),
);
