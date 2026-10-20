import type aiTypes from "@msa/ai/index.types";
import type tuiTypes from "@msa/tui/index.types";
import type { TSchema } from "typebox";

import type { ExternalService } from "../external-services.ts";
import type { McpServerConfig, RegisteredMcpServer } from "../mcp-servers.ts";
import type { ExtensionContext } from "./types-context.ts";
import type { ExtensionVirtualModel, ProviderConfig } from "./types-provider.ts";
import type {
  EntryRenderer,
  MarkdownTransformer,
  MessageRenderer,
  RegisteredCommand,
} from "./types-render.ts";
import type { ToolDefinition, ToolRendererResolver } from "./types-tools.ts";

export interface ExtensionRegistrationApi {
  registerTool<TParams extends TSchema = TSchema, TDetails = unknown, TState = any>(
    tool: ToolDefinition<TParams, TDetails, TState>,
  ): void;

  registerCommand(name: string, options: Omit<RegisteredCommand, "name" | "sourceInfo">): void;

  registerShortcut(
    shortcut: tuiTypes.KeyId,
    options: {
      description?: string;
      handler: (ctx: ExtensionContext) => Promise<void> | void;
    },
  ): void;

  registerFlag(
    name: string,
    options:
      | {
          description?: string;
          type: "boolean";
          default?: boolean;
        }
      | {
          description?: string;
          type: "string";
          default?: string;
        },
  ): void;

  getFlag(name: string): boolean | string | undefined;

  registerMessageRenderer<T = unknown>(customType: string, renderer: MessageRenderer<T>): void;

  registerMarkdownTransformer(transformer: MarkdownTransformer): void;

  registerExternalService(service: ExternalService): void;

  registerEntryRenderer<T = unknown>(customType: string, renderer: EntryRenderer<T>): void;

  registerToolRenderer(resolver: ToolRendererResolver): void;

  registerProvider(provider: aiTypes.Provider): void;
  registerProvider(name: string, config: ProviderConfig): void;

  unregisterProvider(name: string): void;

  registerMcpServer(name: string, config: McpServerConfig): void;

  unregisterMcpServer(name: string): void;

  getMcpServers(): RegisteredMcpServer[];

  registerVirtualModel<TState = unknown>(model: ExtensionVirtualModel<TState>): void;

  unregisterVirtualModel(provider: string, id: string): void;
}
