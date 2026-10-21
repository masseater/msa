import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import type { TSchema } from "typebox";

import type typesRenderTypes from "../types-render.ts";
import type typesToolsTypes from "../types-tools.types.ts";

declare namespace extensionsToolsKit {
  type AgentToolResult<T = aiTypes.JsonValue | undefined> = agentTypes.AgentToolResult<T>;
  type AgentToolUpdateCallback<T = any> = agentTypes.AgentToolUpdateCallback<T>;
  type ToolExecutionMode = agentTypes.ToolExecutionMode;
  type MessageRenderOptions = typesRenderTypes.MessageRenderOptions;
  type MarkdownTransformContext = typesRenderTypes.MarkdownTransformContext;
  type MarkdownTransformer = typesRenderTypes.MarkdownTransformer;
  type EntryRenderOptions = typesRenderTypes.EntryRenderOptions;
  type MessageRenderer<T = unknown> = typesRenderTypes.MessageRenderer<T>;
  type EntryRenderer<T = unknown> = typesRenderTypes.EntryRenderer<T>;
  type RegisteredCommand = typesRenderTypes.RegisteredCommand;
  type ResolvedCommand = typesRenderTypes.ResolvedCommand;
  type ExtensionHandler<E, R = undefined> = typesRenderTypes.ExtensionHandler<E, R>;
  type ToolRenderResultOptions = typesToolsTypes.ToolRenderResultOptions;
  type ToolRenderContext<TState = any, TArgs = any> = typesToolsTypes.ToolRenderContext<
    TState,
    TArgs
  >;
  type ToolExposure = typesToolsTypes.ToolExposure;
  type ToolAnnotations = typesToolsTypes.ToolAnnotations;
  type ToolNamespace = typesToolsTypes.ToolNamespace;
  type ToolLoadout = typesToolsTypes.ToolLoadout;
  type ToolLoadoutChanges = typesToolsTypes.ToolLoadoutChanges;
  type ToolDefinition<
    TParams extends TSchema = TSchema,
    TDetails = unknown,
    TState = any,
  > = typesToolsTypes.ToolDefinition<TParams, TDetails, TState>;
  type ToolRenderers = typesToolsTypes.ToolRenderers;
  type ToolRendererResolver = typesToolsTypes.ToolRendererResolver;
}

export type { extensionsToolsKit as default };
