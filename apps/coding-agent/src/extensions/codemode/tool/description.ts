import type agentTypes from "@msa/agent-core/index.types";
import declarationsModule from "@msa/codemode/declarations";
import type codemodeTypes from "@msa/codemode/index.types";
import { dual } from "effect/Function";

import config from "../../../config.ts";
import platform from "../../../core/platform/index.ts";
import settingsDefaults from "../../../core/settings-defaults.ts";
import type toolInternalTypes from "../tool-internal.types.ts";
import type toolTypes from "../tool.types.ts";
import toolDeclarations from "./declarations.ts";

const { renderToolSample, toCodemodeIdentifier } = declarationsModule;
const { SETTINGS_DEFAULTS } = settingsDefaults;
const { getDocsPath } = config;
const { join } = platform;
const { toCodemodeDeclaration, getCodemodeCallableTools } = toolDeclarations;

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

function addCatalogEntry(
  declaration: Omit<codemodeTypes.CodemodeTool, "execute">,
  group: toolInternalTypes.CatalogGroup,
) {
  const section = renderToolSection(declaration);
  group.entries.push({
    cost: Math.ceil(section.length / CHARS_PER_TOKEN),
    name: declaration.name,
    section,
  });
}

function createCodemodeDescriptionImpl(
  tools: readonly agentTypes.AgentTool<any>[],
  options: toolTypes.CodemodeDescriptionOptions = {},
): string {
  const declarations = getCodemodeCallableTools(tools)
    .filter((tool) => options.deferred?.has(tool.name) !== true)
    .map((tool) => toCodemodeDeclaration(tool, options.guidelines?.get(tool.name)));
  const groups = new Map<string, toolInternalTypes.CatalogGroup>([
    ["", { entries: [], namespace: undefined }],
  ]);
  for (const declaration of declarations) {
    const namespace = options.namespaces?.get(declaration.name);
    const key = namespace === undefined ? "" : `ns:${namespace.name}`;
    const group = groups.get(key) ?? { entries: [], namespace };
    groups.set(key, group);
    addCatalogEntry(declaration, group);
  }
  const ordered = [...groups.values()].sort((a, b) =>
    a.namespace === undefined
      ? -1
      : b.namespace === undefined
        ? 1
        : a.namespace.name.localeCompare(b.namespace.name),
  );
  const shown = selectCatalog(ordered, options.inlineBudget);

  const sections = [DESCRIPTION_INTRO, describeGlobals(options.models === true)];
  if (declarations.length === 0) return sections.join("\n\n");

  const toolSections = ["Nested tools:"];
  for (const { namespace, entries } of ordered) {
    const visible = entries.filter((entry) => shown.has(entry.name));
    if (namespace !== undefined) {
      const listing =
        visible.length === entries.length
          ? ""
          : visible.length === 0
            ? " (tools not listed)"
            : " (some tools not listed)";
      const description = namespace.description?.trim();
      toolSections.push(
        `## ${namespace.name}${listing}${description !== undefined && description !== "" ? `\n${description}` : ""}`,
      );
    }
    for (const entry of visible) toolSections.push(entry.section);
  }
  sections.push(toolSections.join("\n\n"));
  return sections.join("\n\n");
}

const createCodemodeDescription: {
  (
    tools: readonly agentTypes.AgentTool<any>[],
    options?: toolTypes.CodemodeDescriptionOptions,
  ): string;
  (
    options?: toolTypes.CodemodeDescriptionOptions,
  ): (tools: readonly agentTypes.AgentTool<any>[]) => string;
} = dual((args: IArguments) => args.length >= 1, createCodemodeDescriptionImpl);

const toolDescription = {
  CODEMODE_DOCS_PATH,
  DEFAULT_CODEMODE_INLINE_BUDGET,
  createCodemodeDescription,
};

export default toolDescription;
