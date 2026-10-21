import type systemPromptTypes from "../../system-prompt.types.ts";
import type typesApiTypes from "../types-api.ts";
import type typesExtensionTypes from "../types-extension.ts";
import type typesProviderTypes from "../types-provider.ts";
import type typesRuntimeTypes from "../types-runtime.ts";

declare namespace extensionsDefinitionsKit {
  type BuildSystemPromptOptions = systemPromptTypes.BuildSystemPromptOptions;
  type NormalizedBuildSystemPromptOptions = systemPromptTypes.NormalizedBuildSystemPromptOptions;
  type ExtensionAPI = typesApiTypes.ExtensionAPI;
  type Extension = typesExtensionTypes.Extension;
  type LoadExtensionsResult = typesExtensionTypes.LoadExtensionsResult;
  type ExtensionError = typesExtensionTypes.ExtensionError;
  type ExtensionVirtualModel<TState = unknown> = typesProviderTypes.ExtensionVirtualModel<TState>;
  type ProviderConfig = typesProviderTypes.ProviderConfig;
  type ProviderChatModelConfig = typesProviderTypes.ProviderChatModelConfig;
  type ProviderImageModelConfig = typesProviderTypes.ProviderImageModelConfig;
  type ProviderClassifierModelConfig = typesProviderTypes.ProviderClassifierModelConfig;
  type ProviderModelConfig = typesProviderTypes.ProviderModelConfig;
  type ExtensionFactory = typesProviderTypes.ExtensionFactory;
  type InlineExtension = typesProviderTypes.InlineExtension;
  type RegisteredTool = typesProviderTypes.RegisteredTool;
  type ExtensionFlag = typesProviderTypes.ExtensionFlag;
  type ExtensionShortcut = typesProviderTypes.ExtensionShortcut;
  type HandlerFn = typesRuntimeTypes.HandlerFn;
  type SendMessageHandler = typesRuntimeTypes.SendMessageHandler;
  type SendUserMessageHandler = typesRuntimeTypes.SendUserMessageHandler;
  type AppendEntryHandler = typesRuntimeTypes.AppendEntryHandler;
  type SetSessionNameHandler = typesRuntimeTypes.SetSessionNameHandler;
  type GetSessionNameHandler = typesRuntimeTypes.GetSessionNameHandler;
  type GetActiveToolsHandler = typesRuntimeTypes.GetActiveToolsHandler;
  type ToolInfo = typesRuntimeTypes.ToolInfo;
  type GetAllToolsHandler = typesRuntimeTypes.GetAllToolsHandler;
  type GetSettingsHandler = typesRuntimeTypes.GetSettingsHandler;
  type GetCommandsHandler = typesRuntimeTypes.GetCommandsHandler;
  type SetActiveToolsHandler = typesRuntimeTypes.SetActiveToolsHandler;
  type RefreshToolsHandler = typesRuntimeTypes.RefreshToolsHandler;
  type SetModelHandler = typesRuntimeTypes.SetModelHandler;
  type GetThinkingLevelHandler = typesRuntimeTypes.GetThinkingLevelHandler;
  type SetThinkingLevelHandler = typesRuntimeTypes.SetThinkingLevelHandler;
  type SetLabelHandler = typesRuntimeTypes.SetLabelHandler;
}

export type { extensionsDefinitionsKit as default };
