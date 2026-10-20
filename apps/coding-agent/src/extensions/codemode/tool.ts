import type agentTypes from "@msa/agent-core/index.types";
import declarationsModule from "@msa/codemode/declarations";
import type codemodeTypes from "@msa/codemode/index.types";
import source from "@msa/codemode/source";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";
import { type Static, Type } from "typebox";

import { getDocsPath } from "../../config.ts";
import { awaited, awaiting } from "../../core/awaiting.ts";
import type {
  ToolDefinition,
  ToolLoadout,
  ToolLoadoutChanges,
  ToolNamespace,
} from "../../core/extensions/types.ts";
import type { ModelRegistry } from "../../core/model-registry.ts";
import { join } from "../../core/platform-node.ts";
import { SETTINGS_DEFAULTS } from "../../core/settings-defaults.ts";
import type { CodemodeMode } from "../../core/settings-manager.ts";
import { wrapToolDefinition } from "../../core/tools/tool-definition-wrapper.ts";
import { loadCodemodeExecutor } from "./execute.lazy.ts";
import { codemodeRenderers } from "./renderer.ts";

const { renderToolOutputType, renderToolSample, toCodemodeIdentifier } = declarationsModule;
const { CODEMODE_SOURCE_GRAMMAR } = source;

export const CODEMODE_TOOL_NAME = "codemode";

export const CODEMODE_STORE_ENTRY_TYPE = "codemode-store";

export interface CodemodeStoreEntryData {
  set: Record<string, unknown>;
  delete: string[];
}

export type CodemodeModelRuntime = Pick<
  ModelRegistry,
  "getModelsOfType" | "getAvailableOfType" | "getModelOfType" | "classify" | "generateImages"
>;

export interface CodemodeToolOptions {
  getToolNamespace?: (toolName: string) => ToolNamespace | undefined;

  getToolGuidelines?: () => ReadonlyMap<string, readonly string[]>;

  models?: boolean;

  appendEntry?: (customType: string, data: CodemodeStoreEntryData) => void;

  getMode?: () => CodemodeMode;

  getInlineBudget?: () => number | undefined;
}

const TEXT_OUTPUT_SCHEMA: codemodeTypes.CodemodeJsonSchema = { type: "string" };

export const codemodeSchema = Type.Object({
  code: Type.String({
    description: "Raw JavaScript source.",
  }),
});

export type CodemodeToolInput = Static<typeof codemodeSchema>;

export type CodemodeNestedCallStatus = "running" | "ok" | "error" | "cancelled";

export interface CodemodeNestedCall {
  id: string;
  name: string;

  args: string;
  status: CodemodeNestedCallStatus;
  durationMs?: number;

  error?: string;

  cost?: number;
}

export interface CodemodeToolDetails {
  calls: CodemodeNestedCall[];

  fullOutputPath?: string;
}

export const codemodeToolSystemPromptContribution = {
  guidelines: [
    "Use codemode to batch independent tool calls (Promise.allSettled), chain them, or filter large output, instead of many separate calls.",
  ],
  snippet: "Run JavaScript that calls other tools",
} as const;

export const CODEMODE_DOCS_PATH = join(getDocsPath(), "codemode.md");

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

export const DEFAULT_CODEMODE_INLINE_BUDGET = SETTINGS_DEFAULTS.codemode.inlineBudget;

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

export const toCodemodeDeclaration: {
  (
    tool: agentTypes.AgentTool<any>,
    guidelines?: readonly string[],
  ): Omit<codemodeTypes.CodemodeTool, "execute">;
  (
    guidelines?: readonly string[],
  ): (tool: agentTypes.AgentTool<any>) => Omit<codemodeTypes.CodemodeTool, "execute">;
} = dual((args: IArguments) => args.length >= 1, toCodemodeDeclarationImpl);

export function getCodemodeCallableTools(
  tools: readonly agentTypes.AgentTool<any>[],
): agentTypes.AgentTool<any>[] {
  return tools.filter((tool) => tool.name !== CODEMODE_TOOL_NAME);
}

export interface CodemodeDescriptionOptions {
  models?: boolean;

  namespaces?: ReadonlyMap<string, ToolNamespace>;

  deferred?: ReadonlySet<string>;

  guidelines?: ReadonlyMap<string, readonly string[]>;

  inlineBudget?: number;
}

function renderToolSection(declaration: Omit<codemodeTypes.CodemodeTool, "execute">): string {
  const id = toCodemodeIdentifier(declaration.name);
  const heading =
    id === declaration.name ? `### \`${id}\`` : `### \`${id}\` (\`${declaration.name}\`)`;
  return `${heading}\n${renderToolSample(declaration).trim()}`;
}

interface CatalogEntry {
  name: string;
  section: string;
  cost: number;
}

interface CatalogGroup {
  namespace: ToolNamespace | undefined;
  entries: CatalogEntry[];
}

function selectCatalog(groups: readonly CatalogGroup[], budget: number | undefined): Set<string> {
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

function createCodemodeDescriptionImpl(
  tools: readonly agentTypes.AgentTool<any>[],
  options: CodemodeDescriptionOptions = {},
): string {
  const declarations = getCodemodeCallableTools(tools)
    .filter((tool) => options.deferred?.has(tool.name) !== true)
    .map((tool) => toCodemodeDeclaration(tool, options.guidelines?.get(tool.name)));
  const groups = new Map<string, CatalogGroup>([["", { entries: [], namespace: undefined }]]);
  for (const declaration of declarations) {
    const namespace = options.namespaces?.get(declaration.name);
    const key = namespace === undefined ? "" : `ns:${namespace.name}`;
    const group = groups.get(key) ?? { entries: [], namespace };
    groups.set(key, group);
    const section = renderToolSection(declaration);
    group.entries.push({
      cost: Math.ceil(section.length / CHARS_PER_TOKEN),
      name: declaration.name,
      section,
    });
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

export const createCodemodeDescription: {
  (tools: readonly agentTypes.AgentTool<any>[], options?: CodemodeDescriptionOptions): string;
  (options?: CodemodeDescriptionOptions): (tools: readonly agentTypes.AgentTool<any>[]) => string;
} = dual((args: IArguments) => args.length >= 1, createCodemodeDescriptionImpl);

function describeFields(schema: unknown, depth: number): string | undefined {
  if (typeof schema !== "object" || schema === null) return undefined;
  const { type, properties, required } = schema as Record<string, unknown>;
  if (type !== "object" || typeof properties !== "object" || properties === null) return undefined;
  const requiredNames = new Set(Array.isArray(required) ? required : []);
  const fields = Object.entries(properties).map(([name, field]) => {
    const nested = depth > 0 ? describeFields(field, depth - 1) : undefined;
    return `${name}${requiredNames.has(name) ? "" : "?"}${nested !== undefined && nested !== "" ? `: ${nested}` : ""}`;
  });
  return `{ ${fields.join(", ")} }`;
}

function describeOutput(schema: codemodeTypes.CodemodeJsonSchema | undefined): string {
  const type = renderToolOutputType(schema);
  if (type === "string") return "a string";
  const fields = describeFields(schema, 1);
  return `\`${fields ?? type.replace(/\s+/gu, " ")}\``;
}

function describeScriptCall(tool: agentTypes.AgentTool<any>): string {
  return `${tool.description.trim()}\n\nCodemode: \`tools.${toCodemodeIdentifier(tool.name)}(args)\` resolves to ${describeOutput(toCodemodeDeclaration(tool).outputSchema)}.`;
}

function prepareCodemodeLoadout(
  loadout: ToolLoadout,
  options: CodemodeToolOptions,
): ToolLoadoutChanges {
  const mode = options.getMode?.() ?? SETTINGS_DEFAULTS.codemode.mode;
  const isDirect = (tool: agentTypes.AgentTool) => loadout.getExposure(tool.name) === "direct";
  const callable = getCodemodeCallableTools(loadout.callable);
  const callableNames = new Set(callable.map((tool) => tool.name));
  const descriptions: Record<string, string> = {};
  if (mode === "on") {
    for (const tool of loadout.declared) {
      if (callableNames.has(tool.name)) descriptions[tool.name] = describeScriptCall(tool);
    }
  }
  const listed = mode === "only" ? callable : callable.filter((tool) => !isDirect(tool));
  const namespaces = new Map(
    listed.flatMap((tool) => {
      const namespace = loadout.getNamespace(tool.name);
      return namespace === undefined ? [] : [[tool.name, namespace] as const];
    }),
  );
  const guidelines = new Map(
    listed.map((tool) => [tool.name, loadout.getPromptGuidelines(tool.name)] as const),
  );
  descriptions[CODEMODE_TOOL_NAME] = createCodemodeDescription(listed, {
    deferred: new Set(
      listed
        .filter((tool) => loadout.getExposure(tool.name) === "deferred")
        .map((tool) => tool.name),
    ),
    guidelines,
    inlineBudget: options.getInlineBudget?.() ?? DEFAULT_CODEMODE_INLINE_BUDGET,
    models: options.models === true,
    namespaces,
  });
  const declaredNames = new Set(loadout.declared.map((tool) => tool.name));
  return {
    descriptions,
    hiddenDeclarations:
      mode === "only"
        ? callable
            .filter((tool) => isDirect(tool) && declaredNames.has(tool.name))
            .map((tool) => tool.name)
        : [],
  };
}

const DISCOVERY_GLOBALS = /\b(searchTools|describeNamespace|describeTool|ALL_TOOLS)\b/u;

function getScriptReach(code: unknown): "all" | readonly string[] {
  if (typeof code !== "string") return [];
  return DISCOVERY_GLOBALS.test(code) ? "all" : (code.match(/\w+/gu) ?? []);
}

export function createCodemodeToolDefinition(
  options: CodemodeToolOptions = {},
): ToolDefinition<typeof codemodeSchema, CodemodeToolDetails | undefined> {
  return {
    constrainedSampling: { type: "grammar", variants: { openai_lark: CODEMODE_SOURCE_GRAMMAR } },
    description: createCodemodeDescription([], { models: options.models === true }),
    execute: (toolCallId, params, signal, onUpdate, ctx) =>
      Effect.runPromise(
        awaiting(function* () {
          return yield* awaited(
            (yield* awaited(loadCodemodeExecutor())).executeCodemode(
              toolCallId,
              params,
              signal,
              onUpdate,
              ctx,
              options,
            ),
          );
        }),
      ),
    exposure: "model-only",
    label: CODEMODE_TOOL_NAME,
    name: CODEMODE_TOOL_NAME,
    parameters: codemodeSchema,
    prepareLoadout: (loadout) => prepareCodemodeLoadout(loadout, options),
    promptGuidelines: [...codemodeToolSystemPromptContribution.guidelines],
    promptSnippet: codemodeToolSystemPromptContribution.snippet,
    reachesTools: (input) => getScriptReach(input["code"]),
    ...codemodeRenderers,
  };
}

function createCodemodeToolImpl(
  tools: readonly agentTypes.AgentTool<any>[] = [],
  options: CodemodeToolOptions = {},
): agentTypes.AgentTool<typeof codemodeSchema> {
  const definition = createCodemodeToolDefinition(options);
  const tool = wrapToolDefinition(definition);
  Object.assign(tool, {
    description: createCodemodeDescription(tools, { models: options.models === true }),
    promptGuidelines: definition.promptGuidelines,
    promptSnippet: definition.promptSnippet,
  });
  return tool;
}

export const createCodemodeTool: {
  (
    tools?: readonly agentTypes.AgentTool<any>[],
    options?: CodemodeToolOptions,
  ): agentTypes.AgentTool<typeof codemodeSchema>;
  (
    options?: CodemodeToolOptions,
  ): (tools?: readonly agentTypes.AgentTool<any>[]) => agentTypes.AgentTool<typeof codemodeSchema>;
} = dual((args: IArguments) => args.length >= 0, createCodemodeToolImpl);
