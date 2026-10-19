import { NodeServices } from "@effect/platform-node";
import type { ExtensionAPI } from "@msa/coding-agent";
import { FileSystem, ManagedRuntime, Path } from "effect";

const runtime = ManagedRuntime.make(NodeServices.layer);

const findMarkdownFiles = (dir: string): string[] => {
  const fs = runtime.runSync(FileSystem.FileSystem);
  const path = runtime.runSync(Path.Path);
  if (!runtime.runSync(fs.exists(dir))) return [];
  return runtime
    .runSync(fs.readDirectory(dir, { recursive: true }))
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => entry.replaceAll(path.sep, "/"));
};

export default function claudeRulesExtension(msa: ExtensionAPI) {
  let ruleFiles: string[] = [];

  msa.on("session_start", (_event, ctx) => {
    const path = runtime.runSync(Path.Path);
    ruleFiles = findMarkdownFiles(path.join(ctx.cwd, ".claude", "rules"));

    if (ruleFiles.length > 0) {
      ctx.ui.notify(`Found ${ruleFiles.length} rule(s) in .claude/rules/`, "info");
    }
  });

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
