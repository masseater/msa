import type agentTypes from "@msa/agent-core/index.types";
import { Type } from "typebox";

import type extensionsTypesTypes from "../extensions/types.types.ts";
import platform from "../platform/index.ts";
import writeModule from "./renderers/write.ts";
import toolDefinitionWrapper from "./tool-definition-wrapper.ts";
import type toolDefinitionWrapperTypes from "./tool-definition-wrapper.types.ts";
import writeFileModule from "./write-file.ts";
import type writeTypes from "./write.types.ts";

const { nonEmptyOr } = platform;
const { defaultWriteOperations, writeFile } = writeFileModule;
const { writeRenderers } = writeModule;
const { cwdFactory, wrapToolDefinition } = toolDefinitionWrapper;

const writeSchema = Type.Object({
  content: Type.String({ description: "Content to write to the file" }),
  path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
});

type WriteToolDefinition = extensionsTypesTypes.ToolDefinition<typeof writeSchema, undefined>;

const writeToolSystemPromptContribution = {
  guidelines: ["Use write only for new files or complete rewrites."],
  snippet: "Create or overwrite files",
} as const;

const createWriteToolDefinitionImpl = (
  cwd: string,
  options?: writeTypes.WriteToolOptions,
): WriteToolDefinition => {
  const ops = options?.operations ?? defaultWriteOperations;
  return {
    constrainedSampling: { strict: "prefer", type: "json_schema" },
    description:
      "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    execute: (
      _toolCallId,
      { path, content }: { path: string; content: string },
      signal?: AbortSignal,
      _onUpdate?,
      ctx?: writeTypes.WriteToolContext,
    ) => writeFile({ content, cwd: nonEmptyOr(ctx?.cwd, cwd), ops, path, signal }),
    label: "write",
    name: "write",
    parameters: writeSchema,
    promptGuidelines: [...writeToolSystemPromptContribution.guidelines],
    promptSnippet: writeToolSystemPromptContribution.snippet,
    ...writeRenderers,
  };
};

const createWriteToolDefinition: toolDefinitionWrapperTypes.CwdFactory<
  writeTypes.WriteToolOptions,
  WriteToolDefinition
> = cwdFactory(createWriteToolDefinitionImpl);

const createWriteTool: toolDefinitionWrapperTypes.CwdFactory<
  writeTypes.WriteToolOptions,
  agentTypes.AgentTool<typeof writeSchema>
> = cwdFactory((cwd, options) => wrapToolDefinition(createWriteToolDefinitionImpl(cwd, options)));

const write = {
  createWriteTool,
  createWriteToolDefinition,
  writeSchema,
  writeToolSystemPromptContribution,
};

export default write;
