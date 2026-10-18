import type { Provider } from "@msa/ai";

import type { McpServerRegistry } from "../mcp-servers.ts";
import type { VirtualModelDefinition } from "../virtual-models.ts";
import type { ExtensionContext } from "./types-context.ts";
import type { ProviderConfig } from "./types-provider.ts";
import type {
  AppendEntryHandler,
  GetActiveToolsHandler,
  GetAllToolsHandler,
  GetCommandsHandler,
  GetSessionNameHandler,
  GetSettingsHandler,
  GetThinkingLevelHandler,
  RefreshToolsHandler,
  SendMessageHandler,
  SendUserMessageHandler,
  SetActiveToolsHandler,
  SetLabelHandler,
  SetModelHandler,
  SetSessionNameHandler,
  SetThinkingLevelHandler,
} from "./types-runtime.ts";

export interface ExtensionRuntimeState {
  flagValues: Map<string, boolean | string>;
  pendingProviderRegistrations: Array<{
    name: string;
    config: ProviderConfig;
    extensionPath: string;
  }>;
  pendingNativeProviderRegistrations: Array<{ provider: Provider; extensionPath: string }>;
  pendingVirtualModelRegistrations: Array<{
    definition: VirtualModelDefinition;
    extensionPath: string;
  }>;
  createContext: () => ExtensionContext;
  assertActive: () => void;
  invalidate: (message?: string) => void;
  trackEventBusSubscription: (unsubscribe: () => void) => () => void;
  registerProvider: (name: string, config: ProviderConfig, extensionPath?: string) => void;
  registerNativeProvider: (provider: Provider, extensionPath?: string) => void;
  unregisterProvider: (name: string, extensionPath?: string) => void;
  mcpServers: McpServerRegistry;
  registerVirtualModel: (definition: VirtualModelDefinition, extensionPath?: string) => void;
  unregisterVirtualModel: (provider: string, id: string) => void;
}

export interface ExtensionActions {
  sendMessage: SendMessageHandler;
  sendUserMessage: SendUserMessageHandler;
  appendEntry: AppendEntryHandler;
  setSessionName: SetSessionNameHandler;
  getSessionName: GetSessionNameHandler;
  setLabel: SetLabelHandler;
  getActiveTools: GetActiveToolsHandler;
  getAllTools: GetAllToolsHandler;
  getSettings: GetSettingsHandler;
  setActiveTools: SetActiveToolsHandler;
  refreshTools: RefreshToolsHandler;
  getCommands: GetCommandsHandler;
  setModel: SetModelHandler;
  getThinkingLevel: GetThinkingLevelHandler;
  setThinkingLevel: SetThinkingLevelHandler;
}
