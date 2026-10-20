import compat from "@msa/ai/compat";
import {
  ModelRuntime,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
  createAgentSession,
  createExtensionRuntime,
} from "@msa/coding-agent";
import { Config, ConfigProvider, Console, Effect, Option } from "effect";

const { getModel } = compat;

const modelRuntime = await ModelRuntime.create({
  authPath: "/tmp/my-agent/auth.json",
  modelsPath: "/tmp/my-agent/models.json",
});
const anthropicKey = Effect.runSync(
  Config.option(Config.String("MY_ANTHROPIC_KEY"))
    .parse(ConfigProvider.fromEnv({ preserveEmptyStrings: true }))
    .pipe(Effect.map(Option.getOrUndefined), Effect.orDie),
);
if (anthropicKey !== undefined) {
  await modelRuntime.setRuntimeApiKey("anthropic-api", anthropicKey);
}

const model = getModel("anthropic-api", "claude-sonnet-4-5");
if (model === undefined) throw new Error("Model not found");

const settingsManager = SettingsManager.inMemory({
  compaction: { enabled: false },
  retry: { enabled: true, maxRetries: 2 },
});

const cwd = process.cwd();

const resourceLoader: ResourceLoader = {
  extendResources: () => {},
  getAgentsFiles: () => ({ agentsFiles: [] }),
  getAppendSystemPrompt: () => [],
  getAppendSystemPromptSources: () => [],
  getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
  getPrompts: () => ({ prompts: [], diagnostics: [] }),
  getSkills: () => ({ skills: [], diagnostics: [] }),
  getSystemPrompt: () => `You are a minimal assistant.
Available: read, bash. Be concise.`,
  getSystemPromptSource: () => undefined,
  getThemes: () => ({ themes: [], diagnostics: [] }),
  reload: () => Promise.resolve(),
};

const { session } = await createAgentSession({
  agentDir: "/tmp/my-agent",
  cwd,
  model,
  modelRuntime,
  resourceLoader,
  sessionManager: SessionManager.inMemory(cwd),
  settingsManager,
  thinkingLevel: "off",
  tools: ["read", "bash"],
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
