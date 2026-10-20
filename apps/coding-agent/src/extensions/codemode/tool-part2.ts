import type agentTypes from "@msa/agent-core/index.types";
import declarationsModule from "@msa/codemode/declarations";
import type codemodeTypes from "@msa/codemode/index.types";
import { dual } from "effect/Function";

import type toolInternalTypes from "./tool-internal.types.ts";
import toolPart1 from "./tool-part1.ts";
import type toolTypes from "./tool.types.ts";

const { renderToolOutputType, toCodemodeIdentifier } = declarationsModule;
const {
  CHARS_PER_TOKEN,
  DESCRIPTION_INTRO,
  describeGlobals,
  getCodemodeCallableTools,
  renderToolSection,
  selectCatalog,
  toCodemodeDeclaration,
} = toolPart1;

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
    createCodemodeDescriptionImplPart1(declaration, group);
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

function createCodemodeDescriptionImplPart1(
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

const toolPart2 = {
  createCodemodeDescription,
  describeScriptCall,
};

export default toolPart2;
