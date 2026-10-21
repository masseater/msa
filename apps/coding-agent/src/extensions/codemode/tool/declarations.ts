import type agentTypes from "@msa/agent-core/index.types";
import declarationsModule from "@msa/codemode/declarations";
import type codemodeTypes from "@msa/codemode/index.types";
import { dual } from "effect/Function";

import toolSchema from "./schema.ts";

const { toCodemodeIdentifier, renderToolOutputType } = declarationsModule;
const { CODEMODE_TOOL_NAME, TEXT_OUTPUT_SCHEMA } = toolSchema;

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

const toolDeclarations = { describeScriptCall, getCodemodeCallableTools, toCodemodeDeclaration };

export default toolDeclarations;
