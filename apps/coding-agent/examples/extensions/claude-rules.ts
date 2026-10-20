import { NodeServices } from "@effect/platform-node";
import type { ExtensionAPI } from "@msa/coding-agent";
import { Effect, FileSystem, ManagedRuntime, Path } from "effect";

const runtime = ManagedRuntime.make(NodeServices.layer);

const findRuleFiles = (cwd: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const entries = yield* fs
      .readDirectory(path.join(cwd, ".claude", "rules"), { recursive: true })
      .pipe(Effect.orElseSucceed(() => []));
    return entries
      .filter((entry) => entry.endsWith(".md"))
      .map((entry) => entry.replaceAll(path.sep, "/"));
  });

export default function claudeRulesExtension(msa: ExtensionAPI) {
  let ruleFiles: string[] = [];

  msa.on("session_start", (_event, ctx) =>
    runtime.runPromise(
      Effect.gen(function* () {
        ruleFiles = yield* findRuleFiles(ctx.cwd);
        if (ruleFiles.length > 0) {
          ctx.ui.notify(`Found ${ruleFiles.length} rule(s) in .claude/rules/`, "info");
        }
      }),
    ),
  );

  msa.on("before_agent_start", (event) => {
    if (ruleFiles.length === 0) {
      return;
    }

    const rulesList = ruleFiles.map((f) => `- .claude/rules/${f}`).join("\n");

    return {
      systemPrompt:
        event.systemPrompt +
        `

## Project Rules

The following project rules are available in .claude/rules/:

${rulesList}

When working on tasks related to these rules, use the read tool to load the relevant rule files for guidance.
`,
    };
  });
}
