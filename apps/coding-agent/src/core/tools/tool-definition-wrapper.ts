import type agentTypes from "@msa/agent-core/index.types";
import { dual } from "effect/Function";

import type { ExtensionToolContext, ToolDefinition } from "../extensions/types.ts";

export type ToolContextFactory = (
  toolCallId: string,
  signal: AbortSignal | undefined,
) => ExtensionToolContext;

const wrapToolDefinitionImpl = <TDetails = unknown>(
  definition: ToolDefinition<any, TDetails>,
  ctxFactory?: ToolContextFactory,
): agentTypes.AgentTool<any, TDetails> => ({
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

export interface CwdFactory<TOptions, TResult> {
  (options?: TOptions): (cwd: string) => TResult;
  (cwd: string, options?: TOptions): TResult;
}

export const cwdFactory = <TOptions, TResult>(
  make: (cwd: string, options?: TOptions) => TResult,
): CwdFactory<TOptions, TResult> => dual((args) => typeof args[0] === "string", make);

export interface ConfiguredFactory<TConfig, TOptions, TResult> {
  (config: TConfig, options?: TOptions): (cwd: string) => TResult;
  (cwd: string, config: TConfig, options?: TOptions): TResult;
}

export const configuredFactory = <TConfig, TOptions, TResult>(
  make: (cwd: string, config: TConfig, options?: TOptions) => TResult,
): ConfiguredFactory<TConfig, TOptions, TResult> =>
  dual((args) => typeof args[0] === "string", make);

export interface NamedFactory<TName extends string, TOptions, TResult> {
  (cwd: string, options?: TOptions): (name: TName) => TResult;
  (name: TName, cwd: string, options?: TOptions): TResult;
}

export const namedFactory = <TName extends string, TOptions, TResult>(
  make: (name: TName, cwd: string, options?: TOptions) => TResult,
): NamedFactory<TName, TOptions, TResult> => dual((args) => typeof args[1] === "string", make);

const isDefinitionFirst = (args: IArguments): boolean => typeof args[0] !== "function";

export const wrapToolDefinition: {
  <TDetails = unknown>(
    ctxFactory?: ToolContextFactory,
  ): (definition: ToolDefinition<any, TDetails>) => agentTypes.AgentTool<any, TDetails>;
  <TDetails = unknown>(
    definition: ToolDefinition<any, TDetails>,
    ctxFactory?: ToolContextFactory,
  ): agentTypes.AgentTool<any, TDetails>;
} = dual(isDefinitionFirst, wrapToolDefinitionImpl);

export const wrapToolDefinitions: {
  (
    ctxFactory?: ToolContextFactory,
  ): (definitions: ToolDefinition<any, any>[]) => agentTypes.AgentTool<any>[];
  (
    definitions: ToolDefinition<any, any>[],
    ctxFactory?: ToolContextFactory,
  ): agentTypes.AgentTool<any>[];
} = dual(
  (args) => Array.isArray(args[0]),
  (
    definitions: ToolDefinition<any, any>[],
    ctxFactory?: ToolContextFactory,
  ): agentTypes.AgentTool<any>[] =>
    definitions.map((definition) => wrapToolDefinitionImpl(definition, ctxFactory)),
);

export function createToolDefinitionFromAgentTool(
  tool: agentTypes.AgentTool<any>,
): ToolDefinition<any, unknown> {
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
