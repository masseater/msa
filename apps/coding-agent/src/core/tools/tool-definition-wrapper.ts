import type agentTypes from "@msa/agent-core/index.types";
import { dual } from "effect/Function";

import type extensionsTypesTypes from "../extensions/types.types.ts";
import type toolDefinitionWrapperTypes from "./tool-definition-wrapper.types.ts";

const wrapToolDefinitionImpl = <TDetails = unknown>(
  definition: extensionsTypesTypes.ToolDefinition<any, TDetails>,
  ctxFactory?: toolDefinitionWrapperTypes.ToolContextFactory,
): agentTypes.AgentTool<any, TDetails> => ({
  description: definition.description,
  label: definition.label,
  name: definition.name,
  parameters: definition.parameters,
  ...(definition.outputSchema === undefined ? {} : { outputSchema: definition.outputSchema }),
  ...(definition.constrainedSampling === undefined
    ? {}
    : { constrainedSampling: definition.constrainedSampling }),
  ...(definition.prepareArguments === undefined
    ? {}
    : { prepareArguments: definition.prepareArguments }),
  ...(definition.executionMode === undefined ? {} : { executionMode: definition.executionMode }),
  execute: (
    toolCallId,
    params,
    signal,
    onUpdate,
    ctx?: extensionsTypesTypes.ExtensionToolContext,
  ) =>
    definition.execute(
      toolCallId,
      params,
      signal,
      onUpdate,
      ctx ?? (ctxFactory?.(toolCallId, signal) as extensionsTypesTypes.ExtensionToolContext),
    ),
});

const cwdFactory = <TOptions, TResult>(
  make: (cwd: string, options?: TOptions) => TResult,
): toolDefinitionWrapperTypes.CwdFactory<TOptions, TResult> =>
  dual((args) => typeof args[0] === "string", make);

const configuredFactory = <TConfig, TOptions, TResult>(
  make: (cwd: string, config: TConfig, options?: TOptions) => TResult,
): toolDefinitionWrapperTypes.ConfiguredFactory<TConfig, TOptions, TResult> =>
  dual((args) => typeof args[0] === "string", make);

const namedFactory = <TName extends string, TOptions, TResult>(
  make: (name: TName, cwd: string, options?: TOptions) => TResult,
): toolDefinitionWrapperTypes.NamedFactory<TName, TOptions, TResult> =>
  dual((args) => typeof args[1] === "string", make);

const isDefinitionFirst = (args: IArguments): boolean => typeof args[0] !== "function";

const wrapToolDefinition: {
  <TDetails = unknown>(
    ctxFactory?: toolDefinitionWrapperTypes.ToolContextFactory,
  ): (
    definition: extensionsTypesTypes.ToolDefinition<any, TDetails>,
  ) => agentTypes.AgentTool<any, TDetails>;
  <TDetails = unknown>(
    definition: extensionsTypesTypes.ToolDefinition<any, TDetails>,
    ctxFactory?: toolDefinitionWrapperTypes.ToolContextFactory,
  ): agentTypes.AgentTool<any, TDetails>;
} = dual(isDefinitionFirst, wrapToolDefinitionImpl);

const wrapToolDefinitions: {
  (
    ctxFactory?: toolDefinitionWrapperTypes.ToolContextFactory,
  ): (definitions: extensionsTypesTypes.ToolDefinition<any, any>[]) => agentTypes.AgentTool<any>[];
  (
    definitions: extensionsTypesTypes.ToolDefinition<any, any>[],
    ctxFactory?: toolDefinitionWrapperTypes.ToolContextFactory,
  ): agentTypes.AgentTool<any>[];
} = dual(
  (args) => Array.isArray(args[0]),
  (
    definitions: extensionsTypesTypes.ToolDefinition<any, any>[],
    ctxFactory?: toolDefinitionWrapperTypes.ToolContextFactory,
  ): agentTypes.AgentTool<any>[] =>
    definitions.map((definition) => wrapToolDefinitionImpl(definition, ctxFactory)),
);

function createToolDefinitionFromAgentTool(
  tool: agentTypes.AgentTool<any>,
): extensionsTypesTypes.ToolDefinition<any, unknown> {
  return {
    constrainedSampling: tool.constrainedSampling,
    description: tool.description,
    execute: (toolCallId, params, signal, onUpdate) =>
      tool.execute(toolCallId, params, signal, onUpdate),
    executionMode: tool.executionMode,
    label: tool.label,
    name: tool.name,
    outputSchema: tool.outputSchema,
    parameters: tool.parameters as any,
    prepareArguments: tool.prepareArguments,
  };
}

const toolDefinitionWrapper = {
  configuredFactory,
  createToolDefinitionFromAgentTool,
  cwdFactory,
  namedFactory,
  wrapToolDefinition,
  wrapToolDefinitions,
};

export default toolDefinitionWrapper;
