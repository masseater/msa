import { Console, Effect } from "effect";

import {
  createAgentSession,
  createSyntheticSourceInfo,
  DefaultResourceLoader,
  getAgentDir,
  type PromptTemplate,
  SessionManager,
} from "@msa/coding-agent";


const deployTemplate: PromptTemplate = {
  name: "deploy",
  description: "Deploy the application",
  filePath: "/virtual/prompts/deploy.md",
  sourceInfo: createSyntheticSourceInfo("/virtual/prompts/deploy.md", { source: "sdk" }),
  content: `# Deploy Instructions

1. Build: npm run build
2. Test: npm test
3. Deploy: npm run deploy`,
};

const loader = new DefaultResourceLoader({
  cwd: process.cwd(),
  agentDir: getAgentDir(),
  promptsOverride: (current) => ({
    prompts: [...current.prompts, deployTemplate],
    diagnostics: current.diagnostics,
  }),
});
await loader.reload();


const discovered = loader.getPrompts().prompts;
Effect.runSync(Console.log("Discovered prompt templates:"));
for (const template of discovered) {
  Effect.runSync(Console.log(`  /${template.name}: ${template.description}`));
}

const { session } = await createAgentSession({
  resourceLoader: loader,
  sessionManager: SessionManager.inMemory(),
});
Effect.runSync(Console.log(`Session created with ${discovered.length + 1} prompt templates`));
session.dispose();
