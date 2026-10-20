import type aiTypes from "@msa/ai/index.types";

import type mcpServersTypes from "../mcp-servers.types.ts";
import type virtualModelsTypes from "../virtual-models.types.ts";
import type typesContextTypes from "./types-context.ts";
import type typesProviderTypes from "./types-provider.ts";
import type typesRuntimeTypes from "./types-runtime.ts";

declare namespace typesActionsTypes {
  interface ExtensionRuntimeState {
    flagValues: Map<string, boolean | string>;
    pendingProviderRegistrations: Array<{
      name: string;
      config: typesProviderTypes.ProviderConfig;
      extensionPath: string;
    }>;
    pendingNativeProviderRegistrations: Array<{
      provider: aiTypes.Provider;
      extensionPath: string;
    }>;
    pendingVirtualModelRegistrations: Array<{
      definition: virtualModelsTypes.VirtualModelDefinition;
      extensionPath: string;
    }>;
    createContext: () => typesContextTypes.ExtensionContext;
    assertActive: () => void;
    invalidate: (message?: string) => void;
    trackEventBusSubscription: (unsubscribe: () => void) => () => void;
    registerProvider: (
      name: string,
      config: typesProviderTypes.ProviderConfig,
      extensionPath?: string,
    ) => void;
    registerNativeProvider: (provider: aiTypes.Provider, extensionPath?: string) => void;
    unregisterProvider: (name: string, extensionPath?: string) => void;
    mcpServers: mcpServersTypes.McpServerRegistry;
    registerVirtualModel: (
      definition: virtualModelsTypes.VirtualModelDefinition,
      extensionPath?: string,
    ) => void;
    unregisterVirtualModel: (provider: string, id: string) => void;
  }

  interface ExtensionActions {
    sendMessage: typesRuntimeTypes.SendMessageHandler;
    sendUserMessage: typesRuntimeTypes.SendUserMessageHandler;
    appendEntry: typesRuntimeTypes.AppendEntryHandler;
    setSessionName: typesRuntimeTypes.SetSessionNameHandler;
    getSessionName: typesRuntimeTypes.GetSessionNameHandler;
    setLabel: typesRuntimeTypes.SetLabelHandler;
    getActiveTools: typesRuntimeTypes.GetActiveToolsHandler;
    getAllTools: typesRuntimeTypes.GetAllToolsHandler;
    getSettings: typesRuntimeTypes.GetSettingsHandler;
    setActiveTools: typesRuntimeTypes.SetActiveToolsHandler;
    refreshTools: typesRuntimeTypes.RefreshToolsHandler;
    getCommands: typesRuntimeTypes.GetCommandsHandler;
    setModel: typesRuntimeTypes.SetModelHandler;
    getThinkingLevel: typesRuntimeTypes.GetThinkingLevelHandler;
    setThinkingLevel: typesRuntimeTypes.SetThinkingLevelHandler;
  }
}

export type { typesActionsTypes as default };
