import type aiTypes from "@msa/ai/index.types";
import type tuiTypes from "@msa/tui/index.types";
import type { TSchema } from "typebox";

import type externalServicesTypes from "../external-services.types.ts";
import type mcpServersTypes from "../mcp-servers.types.ts";
import type typesContextTypes from "./types-context.ts";
import type typesProviderTypes from "./types-provider.ts";
import type typesRenderTypes from "./types-render.ts";
import type typesToolsTypes from "./types-tools.types.ts";

declare namespace typesApiRegistrationTypes {
  interface ExtensionRegistrationApi {
    registerTool<TParams extends TSchema = TSchema, TDetails = unknown, TState = any>(
      tool: typesToolsTypes.ToolDefinition<TParams, TDetails, TState>,
    ): void;

    registerCommand(
      name: string,
      options: Omit<typesRenderTypes.RegisteredCommand, "name" | "sourceInfo">,
    ): void;

    registerShortcut(
      shortcut: tuiTypes.KeyId,
      options: {
        description?: string;
        handler: (ctx: typesContextTypes.ExtensionContext) => Promise<void> | void;
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

    registerMessageRenderer<T = unknown>(
      customType: string,
      renderer: typesRenderTypes.MessageRenderer<T>,
    ): void;

    registerMarkdownTransformer(transformer: typesRenderTypes.MarkdownTransformer): void;

    registerExternalService(service: externalServicesTypes.ExternalService): void;

    registerEntryRenderer<T = unknown>(
      customType: string,
      renderer: typesRenderTypes.EntryRenderer<T>,
    ): void;

    registerToolRenderer(resolver: typesToolsTypes.ToolRendererResolver): void;

    registerProvider(provider: aiTypes.Provider): void;
    registerProvider(name: string, config: typesProviderTypes.ProviderConfig): void;

    unregisterProvider(name: string): void;

    registerMcpServer(name: string, config: mcpServersTypes.McpServerConfig): void;

    unregisterMcpServer(name: string): void;

    getMcpServers(): mcpServersTypes.RegisteredMcpServer[];

    registerVirtualModel<TState = unknown>(
      model: typesProviderTypes.ExtensionVirtualModel<TState>,
    ): void;

    unregisterVirtualModel(provider: string, id: string): void;
  }
}

export type { typesApiRegistrationTypes as default };
