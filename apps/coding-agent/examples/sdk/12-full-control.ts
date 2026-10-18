import { Config, ConfigProvider, Console, Effect, Option } from "effect";

import { getModel } from "@msa/ai/compat";
import {
  createAgentSession,
  createExtensionRuntime,
  ModelRuntime,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
} from "@msa/coding-agent";

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
  await modelRuntime.setRuntimeApiKey("anthropic", anthropicKey);
}

const model = getModel("anthropic", "claude-sonnet-4-5");
if (model === undefined) throw new Error("Model not found");


const settingsManager = SettingsManager.inMemory({
  compaction: { enabled: false },
  retry: { enabled: true, maxRetries: 2 },
});

const cwd = process.cwd();

const resourceLoader: ResourceLoader = {
  getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
  getSkills: () => ({ skills: [], diagnostics: [] }),
  getPrompts: () => ({ prompts: [], diagnostics: [] }),
  getThemes: () => ({ themes: [], diagnostics: [] }),
  getAgentsFiles: () => ({ agentsFiles: [] }),
  getSystemPrompt: () => `You are a minimal assistant.
Available: read, bash. Be concise.`,
  getSystemPromptSource: () => undefined,
  getAppendSystemPrompt: () => [],
  getAppendSystemPromptSources: () => [],
  extendResources: () => {},
  reload: () => Promise.resolve(),
};

const { session } = await createAgentSession({
  cwd,
  agentDir: "/tmp/my-agent",
  model,
  thinkingLevel: "off",
  modelRuntime,
  resourceLoader,
  tools: ["read", "bash"],
  sessionManager: SessionManager.inMemory(cwd),
  settingsManager,
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
