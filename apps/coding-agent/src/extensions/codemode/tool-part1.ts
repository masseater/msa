import type agentTypes from "@msa/agent-core/index.types";
import declarationsModule from "@msa/codemode/declarations";
import type codemodeTypes from "@msa/codemode/index.types";
import { dual } from "effect/Function";
import { Type } from "typebox";

import config from "../../config.ts";
import platformNode from "../../core/platform-node.ts";
import settingsDefaults from "../../core/settings-defaults.ts";
import type toolInternalTypes from "./tool-internal.types.ts";

const { join } = platformNode;
const { getDocsPath } = config;
const { SETTINGS_DEFAULTS } = settingsDefaults;
const { renderToolSample, toCodemodeIdentifier } = declarationsModule;

const CODEMODE_TOOL_NAME = "codemode";

const CODEMODE_STORE_ENTRY_TYPE = "codemode-store";

const TEXT_OUTPUT_SCHEMA: codemodeTypes.CodemodeJsonSchema = { type: "string" };

const codemodeSchema = Type.Object({
  code: Type.String({
    description: "Raw JavaScript source.",
  }),
});

const codemodeToolSystemPromptContribution = {
  guidelines: [
    "Use codemode to batch independent tool calls (Promise.allSettled), chain them, or filter large output, instead of many separate calls.",
  ],
  snippet: "Run JavaScript that calls other tools",
} as const;

const CODEMODE_DOCS_PATH = join(getDocsPath(), "codemode.md");

const DESCRIPTION_INTRO = `Run JavaScript that calls other tools. The input is raw JavaScript (not JSON, no code fence), run as an async function body in a QuickJS sandbox: top-level \`await\` and \`return\` work. No Node, file system, network, or timers.
- \`await tools.<name>({ ...args })\` resolves to a string, or an object if the tool's declaration says so, and rejects with an Error on failure. A tool whose declaration returns an object resolves on failure too when it returned that object; check its fields. Calls still running when the script ends are cancelled.
- Optional first line: \`// @options: {"max_output_tokens": 10000, "timeout_ms": 60000}\``;

function describeGlobals(models: boolean): string {
  const lines = [
    "Globals:",
    "- `text(value)`, `image(dataUrlOrImageBlock)`, `console.log(...)`, and top-level `return` add output; `exit()` ends the script. With several text items, each starts with a `==> text N/M <==` line, and `console` lines follow the other output in one `<console_output>` block. `image()` also saves the image to a temp file and the result names its path.",
    "- `store(key, value)` and `load(key)` keep JSON values across codemode calls.",
    "- `ALL_TOOLS`, `await searchTools(query, { limit?, namespace? })`, `await describeTool(name)`, `await describeNamespace(name)`: find unlisted tools, such as MCP tools.",
  ];
  if (models) {
    lines.push(`- \`models\`: classifiers and image generation. Read ${CODEMODE_DOCS_PATH} first.`);
  }
  return lines.join("\n");
}

const DEFAULT_CODEMODE_INLINE_BUDGET = SETTINGS_DEFAULTS.codemode.inlineBudget;

const CHARS_PER_TOKEN = 4;

function toCodemodeDeclarationImpl(
  tool: agentTypes.AgentTool<any>,
  guidelines: readonly string[] = [],
): Omit<codemodeTypes.CodemodeTool, "execute"> {
  const bullets = guidelines.flatMap((guideline) =>
    guideline.trim() === "" ? [] : [`- ${guideline.trim()}`],
  );
  return {
    description:
      bullets.length > 0 ? `${tool.description.trim()}\n\n${bullets.join("\n")}` : tool.description,
    inputSchema: tool.parameters as codemodeTypes.CodemodeJsonSchema,
    name: tool.name,
    outputSchema:
      (tool.outputSchema as codemodeTypes.CodemodeJsonSchema | undefined) ?? TEXT_OUTPUT_SCHEMA,
  };
}

const toCodemodeDeclaration: {
  (
    tool: agentTypes.AgentTool<any>,
    guidelines?: readonly string[],
  ): Omit<codemodeTypes.CodemodeTool, "execute">;
  (
    guidelines?: readonly string[],
  ): (tool: agentTypes.AgentTool<any>) => Omit<codemodeTypes.CodemodeTool, "execute">;
} = dual((args: IArguments) => args.length >= 1, toCodemodeDeclarationImpl);

function getCodemodeCallableTools(
  tools: readonly agentTypes.AgentTool<any>[],
): agentTypes.AgentTool<any>[] {
  return tools.filter((tool) => tool.name !== CODEMODE_TOOL_NAME);
}

function renderToolSection(declaration: Omit<codemodeTypes.CodemodeTool, "execute">): string {
  const id = toCodemodeIdentifier(declaration.name);
  const heading =
    id === declaration.name ? `### \`${id}\`` : `### \`${id}\` (\`${declaration.name}\`)`;
  return `${heading}\n${renderToolSample(declaration).trim()}`;
}

function selectCatalog(
  groups: readonly toolInternalTypes.CatalogGroup[],
  budget: number | undefined,
): Set<string> {
  if (budget === undefined)
    return new Set(groups.flatMap((group) => group.entries.map((entry) => entry.name)));
  const queues = groups.map((group) => [...group.entries].sort((a, b) => a.cost - b.cost));
  const shown = new Set<string>();
  let remaining = budget;
  let active = queues.filter((queue) => queue.length > 0);
  while (active.length > 0) {
    const kept: typeof active = [];
    for (const queue of active) {
      const next = queue[0];
      if (next === undefined || next.cost > remaining) continue;
      remaining -= next.cost;
      shown.add(next.name);
      queue.shift();
      if (queue.length > 0) kept.push(queue);
    }
    active = kept;
  }
  return shown;
}

const toolPart1 = {
  CHARS_PER_TOKEN,
  CODEMODE_DOCS_PATH,
  CODEMODE_STORE_ENTRY_TYPE,
  CODEMODE_TOOL_NAME,
  DEFAULT_CODEMODE_INLINE_BUDGET,
  DESCRIPTION_INTRO,
  codemodeSchema,
  codemodeToolSystemPromptContribution,
  describeGlobals,
  getCodemodeCallableTools,
  renderToolSection,
  selectCatalog,
  toCodemodeDeclaration,
};

export default toolPart1;
