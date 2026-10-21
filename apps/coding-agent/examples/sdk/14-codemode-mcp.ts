import codingAgent from "@msa/coding-agent";
import { Console, Effect } from "effect";

const {
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  createAgentSession,
  createCodemodeExtension,
  createMcpExtension,
  createToolSearchExtension,
  getAgentDir,
} = codingAgent;

const cwd = process.cwd();

const resourceLoader = new DefaultResourceLoader({
  agentDir: getAgentDir(),
  cwd,
  extensionFactories: [
    createCodemodeExtension({ mode: "on" }),
    createToolSearchExtension(),

    createMcpExtension(),
  ],
});

void Effect.runPromise(
  Effect.gen(function* () {
    yield* Effect.promise(() => resourceLoader.reload());

    const settingsManager = yield* Effect.promise(() => SettingsManager.create(cwd));

    settingsManager.applyOverrides({ defaultTools: ["+codemode", "+tool_search"] });

    const { session } = yield* Effect.promise(() =>
      createAgentSession({
        resourceLoader,
        sessionManager: SessionManager.inMemory(),
        settingsManager,
      }),
    );

    try {
      yield* Effect.promise(() => session.extensions.binding.bindExtensions({}));
      yield* Console.log("Active tools:", session.tools.loadout.getActiveToolNames().join(", "));
      session.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          process.stdout.write(event.assistantMessageEvent.delta);
        }
      });
      yield* Effect.promise(() =>
        session.run.prompting.prompt(
          "Use codemode to count the TypeScript files in src/ and list the three largest.",
        ),
      );
      yield* Console.log();
    } finally {
      session.dispose();
    }
  }),
);
