import type agentTypes from "@msa/agent-core/index.types";

import readContent from "./read-content.ts";
import readFileModule from "./read-file.ts";
import type readTypes from "./read.types.ts";
import readModule from "./renderers/read.ts";
import toolDefinitionWrapper from "./tool-definition-wrapper.ts";
import type toolDefinitionWrapperTypes from "./tool-definition-wrapper.types.ts";

const { readDescription, readOutputSchema, readSchema, readToolSystemPromptContribution } =
  readContent;
const { defaultReadOperations, readFile } = readFileModule;
const { readRenderers } = readModule;
const { cwdFactory, wrapToolDefinition } = toolDefinitionWrapper;

const createReadToolDefinitionImpl = (
  cwd: string,
  options?: readTypes.ReadToolOptions,
): readTypes.ReadToolDefinition => {
  const ops = options?.operations ?? defaultReadOperations;
  return {
    annotations: { readOnlyHint: true },
    constrainedSampling: { strict: "prefer", type: "json_schema" },
    description: readDescription,
    execute: (
      _toolCallId,
      { path, offset, limit }: { path: string; offset?: number; limit?: number },
      signal?: AbortSignal,
      _onUpdate?,
      ctx?: readTypes.ReadToolContext,
    ) => readFile({ ctx, cwd, limit, offset, ops, options, path, signal }),
    label: "read",
    name: "read",
    outputSchema: readOutputSchema,
    parameters: readSchema,
    promptGuidelines: [...readToolSystemPromptContribution.guidelines],
    promptSnippet: readToolSystemPromptContribution.snippet,
    ...readRenderers,
  };
};

const createReadToolDefinition: toolDefinitionWrapperTypes.CwdFactory<
  readTypes.ReadToolOptions,
  readTypes.ReadToolDefinition
> = cwdFactory(createReadToolDefinitionImpl);

const createReadTool: toolDefinitionWrapperTypes.CwdFactory<
  readTypes.ReadToolOptions,
  agentTypes.AgentTool<typeof readSchema>
> = cwdFactory((cwd, options) => wrapToolDefinition(createReadToolDefinitionImpl(cwd, options)));

const read = {
  createReadTool,
  createReadToolDefinition,
  readToolSystemPromptContribution: readContent.readToolSystemPromptContribution,
};

export default read;
