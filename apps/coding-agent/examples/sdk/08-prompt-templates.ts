import codingAgent from "@msa/coding-agent";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Console, Effect } from "effect";

const {
  DefaultResourceLoader,
  SessionManager,
  createAgentSession,
  createSyntheticSourceInfo,
  getAgentDir,
} = codingAgent;

const deployTemplate: codingAgentTypes.PromptTemplate = {
  content: `# Deploy Instructions

1. Build: npm run build
2. Test: npm test
3. Deploy: npm run deploy`,
  description: "Deploy the application",
  filePath: "/virtual/prompts/deploy.md",
  name: "deploy",
  sourceInfo: createSyntheticSourceInfo("/virtual/prompts/deploy.md", { source: "sdk" }),
};

const loader = new DefaultResourceLoader({
  agentDir: getAgentDir(),
  cwd: process.cwd(),
  promptsOverride: (current) => ({
    diagnostics: current.diagnostics,
    prompts: [...current.prompts, deployTemplate],
  }),
});

void Effect.runPromise(
  Effect.gen(function* () {
    yield* Effect.promise(() => loader.reload());

    const discovered = loader.getPrompts().prompts;
    yield* Console.log("Discovered prompt templates:");
    for (const template of discovered) {
      yield* Console.log(`  /${template.name}: ${template.description}`);
    }

    const { session } = yield* Effect.promise(() =>
      createAgentSession({
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(),
      }),
    );
    yield* Console.log(`Session created with ${discovered.length + 1} prompt templates`);
    session.dispose();
  }),
);
