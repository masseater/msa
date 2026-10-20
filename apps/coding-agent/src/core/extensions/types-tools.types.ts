import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import type tuiTypes from "@msa/tui/index.types";
import type { Static, TSchema } from "typebox";

import type themeTypes from "../../modes/interactive/theme/theme.types.ts";
import type typesContextTypes from "./types-context.ts";

declare namespace typesToolsTypes {
  interface ToolRenderResultOptions {
    expanded: boolean;
    isPartial: boolean;
  }

  interface ToolRenderContext<TState = any, TArgs = any> {
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

  type ToolExposure = "direct" | "model-only" | "codemode" | "deferred" | "hidden";

  interface ToolAnnotations {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  }

  interface ToolNamespace {
    name: string;
    aliases?: readonly string[];
    description?: string;
    instructions?: string;
  }

  interface ToolLoadout {
    readonly declared: readonly agentTypes.AgentTool[];
    readonly callable: readonly agentTypes.AgentTool[];
    readonly registered: readonly agentTypes.AgentTool[];
    getExposure(name: string): ToolExposure;
    getNamespace(name: string): ToolNamespace | undefined;
    getPromptGuidelines(name: string): readonly string[];
  }

  interface ToolLoadoutChanges {
    descriptions?: Readonly<Record<string, string>>;
    hiddenDeclarations?: readonly string[];
  }

  interface ToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown, TState = any> {
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
      ctx: typesContextTypes.ExtensionToolContext,
    ): Promise<agentTypes.AgentToolResult<TDetails>>;

    renderCall?: (
      args: Static<TParams>,
      theme: themeTypes.Theme,
      context: ToolRenderContext<TState, Static<TParams>>,
    ) => tuiTypes.Component;

    renderResult?: (
      result: agentTypes.AgentToolResult<TDetails>,
      options: ToolRenderResultOptions,
      theme: themeTypes.Theme,
      context: ToolRenderContext<TState, Static<TParams>>,
    ) => tuiTypes.Component;
  }

  type AnyToolDefinition = ToolDefinition<any, any, any>;

  type ToolRenderers = Pick<AnyToolDefinition, "renderShell" | "renderCall" | "renderResult">;

  type ToolRendererResolver = (
    toolName: string,
    next: () => ToolRenderers | undefined,
  ) => ToolRenderers | undefined;
}

export type { typesToolsTypes as default };
