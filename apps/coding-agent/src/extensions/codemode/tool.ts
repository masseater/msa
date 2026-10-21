import type agentTypes from "@msa/agent-core/index.types";
import { dual } from "effect/Function";

import toolDefinitionWrapper from "../../core/tools/tool-definition-wrapper.ts";
import type toolTypes from "./tool.types.ts";
import toolDeclarations from "./tool/declarations.ts";
import toolDefinition from "./tool/definition.ts";
import toolDescription from "./tool/description.ts";
import toolSchema from "./tool/schema.ts";

const { wrapToolDefinition } = toolDefinitionWrapper;
const { createCodemodeToolDefinition } = toolDefinition;
const {
  codemodeToolSystemPromptContribution,
  CODEMODE_TOOL_NAME,
  codemodeSchema,
  CODEMODE_STORE_ENTRY_TYPE,
} = toolSchema;
const { createCodemodeDescription, CODEMODE_DOCS_PATH, DEFAULT_CODEMODE_INLINE_BUDGET } =
  toolDescription;

function createCodemodeToolImpl(
  tools: readonly agentTypes.AgentTool<any>[] = [],
  options: toolTypes.CodemodeToolOptions = {},
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

const createCodemodeTool: {
  (
    tools?: readonly agentTypes.AgentTool<any>[],
    options?: toolTypes.CodemodeToolOptions,
  ): agentTypes.AgentTool<typeof codemodeSchema>;
  (
    options?: toolTypes.CodemodeToolOptions,
  ): (tools?: readonly agentTypes.AgentTool<any>[]) => agentTypes.AgentTool<typeof codemodeSchema>;
} = dual((args: IArguments) => args.length >= 0, createCodemodeToolImpl);

const { getCodemodeCallableTools, toCodemodeDeclaration } = toolDeclarations;

const tool = {
  CODEMODE_DOCS_PATH,
  CODEMODE_STORE_ENTRY_TYPE,
  CODEMODE_TOOL_NAME,
  DEFAULT_CODEMODE_INLINE_BUDGET,
  codemodeSchema,
  codemodeToolSystemPromptContribution,
  createCodemodeDescription,
  createCodemodeTool,
  createCodemodeToolDefinition,
  getCodemodeCallableTools,
  toCodemodeDeclaration,
};

export default tool;
