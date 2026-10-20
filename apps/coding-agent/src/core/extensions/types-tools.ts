import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import type tuiTypes from "@msa/tui/index.types";
import type { Static, TSchema } from "typebox";

import type { Theme } from "../../modes/interactive/theme/theme.ts";
import type { ExtensionToolContext } from "./types-context.ts";

export interface ToolRenderResultOptions {
  expanded: boolean;
  isPartial: boolean;
}

export interface ToolRenderContext<TState = any, TArgs = any> {
  args: TArgs;
  toolCallId: string;
  invalidate: () => void;
  lastComponent: tuiTypes.Component | undefined;
  state: TState;
  cwd: string;
  executionStarted: boolean;
  argsComplete: boolean;
  isPartial: boolean;
  expanded: boolean;
  showImages: boolean;
  isError: boolean;
  durationMs: number | undefined;
  outputPad: number;
}

export type ToolExposure = "direct" | "model-only" | "codemode" | "deferred" | "hidden";

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolNamespace {
  name: string;
  aliases?: readonly string[];
  description?: string;
  instructions?: string;
}

export interface ToolLoadout {
  readonly declared: readonly agentTypes.AgentTool[];
  readonly callable: readonly agentTypes.AgentTool[];
  readonly registered: readonly agentTypes.AgentTool[];
  getExposure(name: string): ToolExposure;
  getNamespace(name: string): ToolNamespace | undefined;
  getPromptGuidelines(name: string): readonly string[];
}

export interface ToolLoadoutChanges {
  descriptions?: Readonly<Record<string, string>>;
  hiddenDeclarations?: readonly string[];
}

export interface ToolDefinition<
  TParams extends TSchema = TSchema,
  TDetails = unknown,
  TState = any,
> {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[] | undefined;
  parameters: TParams;
  constrainedSampling?: false | aiTypes.ConstrainedSamplingConfig | undefined;
  renderShell?: "default" | "self";

  prepareArguments?: ((args: unknown) => Static<TParams>) | undefined;

  outputSchema?: TSchema | undefined;

  exposure?: ToolExposure;

  namespace?: ToolNamespace;

  reachesTools?: (input: Record<string, unknown>) => "all" | readonly string[];

  annotations?: ToolAnnotations;

  readOnlyVariant?: ToolDefinition<any, any>;

  defaultActive?: boolean;

  prepareLoadout?: (loadout: ToolLoadout) => ToolLoadoutChanges | undefined;

  executionMode?: agentTypes.ToolExecutionMode | undefined;

  execute(
    toolCallId: string,
    params: Static<TParams>,
    signal: AbortSignal | undefined,
    onUpdate: agentTypes.AgentToolUpdateCallback<TDetails> | undefined,
    ctx: ExtensionToolContext,
  ): Promise<agentTypes.AgentToolResult<TDetails>>;

  renderCall?: (
    args: Static<TParams>,
    theme: Theme,
    context: ToolRenderContext<TState, Static<TParams>>,
  ) => tuiTypes.Component;

  renderResult?: (
    result: agentTypes.AgentToolResult<TDetails>,
    options: ToolRenderResultOptions,
    theme: Theme,
    context: ToolRenderContext<TState, Static<TParams>>,
  ) => tuiTypes.Component;
}

type AnyToolDefinition = ToolDefinition<any, any, any>;

export type ToolRenderers = Pick<AnyToolDefinition, "renderShell" | "renderCall" | "renderResult">;

export type ToolRendererResolver = (
  toolName: string,
  next: () => ToolRenderers | undefined,
) => ToolRenderers | undefined;

export function defineTool<TParams extends TSchema, TDetails = unknown, TState = any>(
  tool: ToolDefinition<TParams, TDetails, TState>,
): ToolDefinition<TParams, TDetails, TState> & AnyToolDefinition {
  return tool as ToolDefinition<TParams, TDetails, TState> & AnyToolDefinition;
}
