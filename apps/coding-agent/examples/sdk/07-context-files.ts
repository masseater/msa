import {
  DefaultResourceLoader,
  SessionManager,
  createAgentSession,
  getAgentDir,
} from "@msa/coding-agent";
import { Console, Effect } from "effect";

const loader = new DefaultResourceLoader({
  agentDir: getAgentDir(),
  agentsFilesOverride: (current) => ({
    agentsFiles: [
      ...current.agentsFiles,
      {
        path: "/virtual/AGENTS.md",
        content: `# Project Guidelines

## Code Style
- Use TypeScript strict mode
- No any types
- Prefer const over let`,
      },
    ],
  }),
  cwd: process.cwd(),
});
await loader.reload();

const discovered = loader.getAgentsFiles().agentsFiles;
Effect.runSync(Console.log("Discovered context files:"));
for (const file of discovered) {
  Effect.runSync(Console.log(`  - ${file.path} (${file.content.length} chars)`));
}

const { session } = await createAgentSession({
  resourceLoader: loader,
  sessionManager: SessionManager.inMemory(),
});
Effect.runSync(Console.log(`Session created with ${discovered.length + 1} context files`));
session.dispose();
