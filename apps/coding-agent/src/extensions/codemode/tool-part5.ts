import type agentTypes from "@msa/agent-core/index.types";
import { dual } from "effect/Function";

import toolDefinitionWrapper from "../../core/tools/tool-definition-wrapper.ts";
import toolPart1 from "./tool-part1.ts";
import toolPart2 from "./tool-part2.ts";
import toolPart4 from "./tool-part4.ts";
import type toolTypes from "./tool.types.ts";

const { wrapToolDefinition } = toolDefinitionWrapper;
const { codemodeSchema } = toolPart1;
const { createCodemodeToolDefinition } = toolPart4;
const { createCodemodeDescription } = toolPart2;

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

const toolPart5 = {
  createCodemodeTool,
};

export default toolPart5;
