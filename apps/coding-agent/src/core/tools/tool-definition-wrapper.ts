import type { AgentTool } from "@msa/agent-core";
import { dual } from "effect/Function";

import type { ExtensionToolContext, ToolDefinition } from "../extensions/types.ts";

export type ToolContextFactory = (
  toolCallId: string,
  signal: AbortSignal | undefined,
) => ExtensionToolContext;

const wrapToolDefinitionImpl = <TDetails = unknown>(
  definition: ToolDefinition<any, TDetails>,
  ctxFactory?: ToolContextFactory,
): AgentTool<any, TDetails> => ({
  name: definition.name,
  label: definition.label,
  description: definition.description,
  parameters: definition.parameters,
  ...(definition.outputSchema === undefined ? {} : { outputSchema: definition.outputSchema }),
  ...(definition.constrainedSampling === undefined
    ? {}
    : { constrainedSampling: definition.constrainedSampling }),
  ...(definition.prepareArguments === undefined
    ? {}
    : { prepareArguments: definition.prepareArguments }),
  ...(definition.executionMode === undefined ? {} : { executionMode: definition.executionMode }),
  execute: (toolCallId, params, signal, onUpdate, ctx?: ExtensionToolContext) =>
    definition.execute(
      toolCallId,
      params,
      signal,
      onUpdate,
      ctx ?? (ctxFactory?.(toolCallId, signal) as ExtensionToolContext),
    ),
});

const isDefinitionFirst = (args: IArguments): boolean => typeof args[0] !== "function";

export const wrapToolDefinition: {
  <TDetails = unknown>(
    ctxFactory?: ToolContextFactory,
  ): (definition: ToolDefinition<any, TDetails>) => AgentTool<any, TDetails>;
  <TDetails = unknown>(
    definition: ToolDefinition<any, TDetails>,
    ctxFactory?: ToolContextFactory,
  ): AgentTool<any, TDetails>;
} = dual(isDefinitionFirst, wrapToolDefinitionImpl);

export const wrapToolDefinitions: {
  (ctxFactory?: ToolContextFactory): (definitions: ToolDefinition<any, any>[]) => AgentTool<any>[];
  (definitions: ToolDefinition<any, any>[], ctxFactory?: ToolContextFactory): AgentTool<any>[];
} = dual(
  (args) => Array.isArray(args[0]),
  (definitions: ToolDefinition<any, any>[], ctxFactory?: ToolContextFactory): AgentTool<any>[] =>
    definitions.map((definition) => wrapToolDefinitionImpl(definition, ctxFactory)),
);

export function createToolDefinitionFromAgentTool(
  tool: AgentTool<any>,
): ToolDefinition<any, unknown> {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters as any,
    outputSchema: tool.outputSchema,
    constrainedSampling: tool.constrainedSampling,
    prepareArguments: tool.prepareArguments,
    executionMode: tool.executionMode,
    execute: (toolCallId, params, signal, onUpdate) =>
      tool.execute(toolCallId, params, signal, onUpdate),
  };
}
