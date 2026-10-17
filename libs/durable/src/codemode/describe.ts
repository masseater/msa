import type { CodemodeJsonSchema } from "@msa/codemode";
import { renderToolSample, toCodemodeIdentifier } from "@msa/codemode/declarations";
import { Function } from "effect";

import type { Dual2, Dual3 } from "../dual.ts";
import type { ToolRegistration } from "../harness/types.ts";
import { MODELS_DESCRIPTION } from "./models.ts";

export type CodemodeNamespace = {
  readonly name: string;
  readonly description?: string;
  readonly instructions?: string;
  readonly prefix: string;
};

export const DEFAULT_CODEMODE_INLINE_BUDGET = 3000;
const CHARS_PER_TOKEN = 4;

const TEXT_OUTPUT_SCHEMA: CodemodeJsonSchema = { type: "string" };

const DESCRIPTION_INTRO = `Run JavaScript that calls other tools. The input is raw JavaScript (not JSON, no code fence), run as an async function body in a QuickJS sandbox: top-level \`await\` and \`return\` work. No Node, file system, network, or timers.
- \`await tools.<name>({ ...args })\` resolves to a string, or an object if the tool's declaration says so, and rejects with an Error on failure. A tool whose declaration returns an object resolves on failure too when it returned that object; check its fields. Calls still running when the script ends are cancelled.
- The script survives a restart: it resumes where it was, without running finished calls again.
- Optional first line: \`// @options: {"max_output_tokens": 10000, "timeout_ms": 60000}\``;

export function codemodeDescription(models: boolean): string {
  const globals = [
    "Globals:",
    "- `text(value)`, `image(dataUrlOrImageBlock)`, `console.log(...)`, and top-level `return` add output; `exit()` ends the script. With several text items, each starts with a `==> text N/M <==` line, and `console` lines follow the other output in one `<console_output>` block. `image()` also saves the image to a temp file and the result names its path.",
    "- `store(key, value)` and `load(key)` keep JSON values across codemode calls.",
    "- `ALL_TOOLS`, `await searchTools(query, { limit?, namespace? })`, `await describeTool(name)`, `await describeNamespace(name)`: find tools the `codemode` section does not list.",
  ];
  return [
    DESCRIPTION_INTRO,
    globals.join("\n"),
    ...(models ? [MODELS_DESCRIPTION] : []),
    "The `codemode` section of the system prompt lists the tools scripts can call, by namespace, as far as space allows.",
  ].join("\n\n");
}

export function declarationOf(tool: ToolRegistration): {
  name: string;
  description: string;
  inputSchema: CodemodeJsonSchema;
  outputSchema: CodemodeJsonSchema;
} {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters as CodemodeJsonSchema,
    outputSchema:
      (tool.structuredOutputSchema as CodemodeJsonSchema | undefined) ?? TEXT_OUTPUT_SCHEMA,
  };
}

export function sampleOf(tool: ToolRegistration): string {
  return renderToolSample(declarationOf(tool));
}

export const namespaceOf: Dual2<
  string,
  readonly CodemodeNamespace[],
  CodemodeNamespace | undefined
> = Function.dual(
  2,
  (name: string, namespaces: readonly CodemodeNamespace[]): CodemodeNamespace | undefined => {
    let found: CodemodeNamespace | undefined;
    for (const namespace of namespaces) {
      if (
        name.startsWith(namespace.prefix) &&
        (found === undefined || namespace.prefix.length > found.prefix.length)
      ) {
        found = namespace;
      }
    }
    return found;
  },
);

function renderToolSection(tool: ToolRegistration): string {
  const id = toCodemodeIdentifier(tool.name);
  const heading = id === tool.name ? `### \`${id}\`` : `### \`${id}\` (\`${tool.name}\`)`;
  return `${heading}\n${sampleOf(tool).trim()}`;
}

type CatalogEntry = { name: string; section: string; cost: number };
type CatalogGroup = { namespace: CodemodeNamespace | undefined; entries: CatalogEntry[] };

function selectCatalog(groups: readonly CatalogGroup[], budget: number): Set<string> {
  const queues = groups.map((group) => [...group.entries].sort((a, b) => a.cost - b.cost));
  const shown = new Set<string>();
  let round = { active: queues.filter((queue) => queue.length > 0), remaining: budget };
  while (round.active.length > 0) round = placeRound(round.active, round.remaining, shown);
  return shown;
}

function placeRound(
  active: readonly CatalogEntry[][],
  budget: number,
  shown: Set<string>,
): { active: CatalogEntry[][]; remaining: number } {
  let remaining = budget;
  const next = active.filter((queue) => {
    const cheapest = queue[0]!;
    if (cheapest.cost > remaining) return false;
    remaining -= cheapest.cost;
    shown.add(cheapest.name);
    queue.shift();
    return queue.length > 0;
  });
  return { active: next, remaining };
}

function catalogGroups(
  tools: readonly ToolRegistration[],
  namespaces: readonly CodemodeNamespace[],
): CatalogGroup[] {
  const groups = new Map<string, CatalogGroup>([["", { namespace: undefined, entries: [] }]]);
  for (const tool of tools) {
    const namespace = namespaceOf(tool.name, namespaces);
    const key = namespace === undefined ? "" : `ns:${namespace.name}`;
    const group = groups.get(key) ?? { namespace, entries: [] };
    groups.set(key, group);
    const section = renderToolSection(tool);
    group.entries.push({
      name: tool.name,
      section,
      cost: Math.ceil(section.length / CHARS_PER_TOKEN),
    });
  }
  return [...groups.values()].sort((a, b) =>
    a.namespace === undefined
      ? -1
      : b.namespace === undefined
        ? 1
        : a.namespace.name.localeCompare(b.namespace.name),
  );
}

const sectionCode = (
  tools: readonly ToolRegistration[],
  namespaces: readonly CodemodeNamespace[],
  budget: number,
): string | undefined => {
  if (tools.length === 0) return undefined;
  const ordered = catalogGroups(tools, namespaces);
  const shown = selectCatalog(ordered, budget);

  const toolSections = ["Tools scripts can call (`await tools.<name>(args)`):"];
  for (const { namespace, entries } of ordered) {
    if (entries.length === 0) continue;
    const visible = entries.filter((entry) => shown.has(entry.name));
    if (namespace !== undefined) {
      const listing =
        visible.length === entries.length
          ? ""
          : visible.length === 0
            ? " (tools not listed)"
            : " (some tools not listed)";
      const description = namespace.description?.trim();
      const described = description === undefined || description === "" ? "" : `\n${description}`;
      toolSections.push(`## ${namespace.name}${listing}${described}`);
    } else if (visible.length < entries.length) {
      toolSections.push("Some tools are not listed: find them with `searchTools()`.");
    }
    for (const entry of visible) toolSections.push(entry.section);
  }
  return toolSections.join("\n\n");
};

export const codemodeSection: Dual3<
  readonly ToolRegistration[],
  readonly CodemodeNamespace[],
  number,
  string | undefined
> = Function.dual(3, sectionCode);
