import codingAgent from "@msa/coding-agent";
import { Console, Effect } from "effect";

const { DefaultResourceLoader, SessionManager, createAgentSession, getAgentDir } = codingAgent;

const loader = new DefaultResourceLoader({
  agentDir: getAgentDir(),
  agentsFilesOverride: (current) => ({
    agentsFiles: [
      ...current.agentsFiles,
      {
        content: `# Project Guidelines

## Code Style
- Use TypeScript strict mode
- No any types
- Prefer const over let`,
        path: "/virtual/AGENTS.md",
      },
    ],
  }),
  cwd: process.cwd(),
});

void Effect.runPromise(
  Effect.gen(function* () {
    yield* Effect.promise(() => loader.reload());

    const discovered = loader.getAgentsFiles().agentsFiles;
    yield* Console.log("Discovered context files:");
    for (const file of discovered) {
      yield* Console.log(`  - ${file.path} (${file.content.length} chars)`);
    }

    const { session } = yield* Effect.promise(() =>
      createAgentSession({
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(),
      }),
    );
    yield* Console.log(`Session created with ${discovered.length + 1} context files`);
    session.dispose();
  }),
);
