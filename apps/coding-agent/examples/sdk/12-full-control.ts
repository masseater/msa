import compat from "@msa/ai/compat";
import codingAgent from "@msa/coding-agent";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Config, ConfigProvider, Console, Effect, Option } from "effect";

const {
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
  createExtensionRuntime,
} = codingAgent;

const { getModel } = compat;

const resourceLoader: codingAgentTypes.ResourceLoader = {
  extendResources: () => {},
  getAgentsFiles: () => ({ agentsFiles: [] }),
  getAppendSystemPrompt: () => [],
  getAppendSystemPromptSources: () => [],
  getExtensions: () => ({ errors: [], extensions: [], runtime: createExtensionRuntime() }),
  getPrompts: () => ({ diagnostics: [], prompts: [] }),
  getSkills: () => ({ diagnostics: [], skills: [] }),
  getSystemPrompt: () => `You are a minimal assistant.
Available: read, bash. Be concise.`,
  getSystemPromptSource: () => undefined,
  getThemes: () => ({ diagnostics: [], themes: [] }),
  reload: () => Promise.resolve(),
};

const settingsManager = SettingsManager.inMemory({
  compaction: { enabled: false },
  retry: { enabled: true, maxRetries: 2 },
});

void Effect.runPromise(
  Effect.gen(function* () {
    const modelRuntime = yield* Effect.promise(() =>
      ModelRuntime.create({
        authPath: "/tmp/my-agent/auth.json",
        modelsPath: "/tmp/my-agent/models.json",
      }),
    );
    const anthropicKey = yield* Config.option(Config.String("MY_ANTHROPIC_KEY"))
      .parse(ConfigProvider.fromEnv({ preserveEmptyStrings: true }))
      .pipe(Effect.map(Option.getOrUndefined), Effect.orDie);
    if (anthropicKey !== undefined) {
      yield* Effect.promise(() => modelRuntime.setRuntimeApiKey("anthropic-api", anthropicKey));
    }

    const model = getModel("anthropic-api", "claude-sonnet-4-5");
    if (model === undefined) throw new Error("Model not found");

    const cwd = process.cwd();

    const { session } = yield* Effect.promise(() =>
      createAgentSession({
        agentDir: "/tmp/my-agent",
        cwd,
        model,
        modelRuntime,
        resourceLoader,
        sessionManager: SessionManager.inMemory(cwd),
        settingsManager,
        thinkingLevel: "off",
        tools: ["read", "bash"],
      }),
    );

    try {
      session.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          process.stdout.write(event.assistantMessageEvent.delta);
        }
      });

      yield* Effect.promise(() =>
        session.run.prompting.prompt("List files in the current directory."),
      );
      yield* Console.log();
    } finally {
      session.dispose();
    }
  }),
);
