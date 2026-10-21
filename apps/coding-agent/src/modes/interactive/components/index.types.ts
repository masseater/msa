import type componentsChromeKitTypes from "./index-kit/chrome.types.ts";
import type componentsDialogsKitTypes from "./index-kit/dialogs.types.ts";
import type componentsMessagesKitTypes from "./index-kit/messages.types.ts";
import type componentsSelectorsKitTypes from "./index-kit/selectors.types.ts";

declare namespace componentsTypes {
  type ArminComponent = componentsChromeKitTypes.ArminComponent;
  type AssistantMessageComponent = componentsMessagesKitTypes.AssistantMessageComponent;
  type BashExecutionComponent = componentsMessagesKitTypes.BashExecutionComponent;
  type BorderedLoader = componentsChromeKitTypes.BorderedLoader;
  type BranchSummaryMessageComponent = componentsMessagesKitTypes.BranchSummaryMessageComponent;
  type CompactionSummaryMessageComponent =
    componentsMessagesKitTypes.CompactionSummaryMessageComponent;
  type CustomEditor = componentsChromeKitTypes.CustomEditor;
  type CustomEditorOptions = componentsChromeKitTypes.CustomEditorOptions;
  type CustomMessageComponent = componentsMessagesKitTypes.CustomMessageComponent;
  type RenderDiffOptions = componentsMessagesKitTypes.RenderDiffOptions;
  type DynamicBorder = componentsChromeKitTypes.DynamicBorder;
  type ExtensionEditorComponent = componentsDialogsKitTypes.ExtensionEditorComponent;
  type ExtensionInputComponent = componentsDialogsKitTypes.ExtensionInputComponent;
  type ExtensionSelectorComponent = componentsDialogsKitTypes.ExtensionSelectorComponent;
  type FirstTimeSetupComponent = componentsDialogsKitTypes.FirstTimeSetupComponent;
  type FirstTimeSetupOptions = componentsDialogsKitTypes.FirstTimeSetupOptions;
  type FirstTimeSetupResult = componentsDialogsKitTypes.FirstTimeSetupResult;
  type FooterComponent = componentsChromeKitTypes.FooterComponent;
  type LoginDialogComponent = componentsDialogsKitTypes.LoginDialogComponent;
  type ModelSelectorComponent = componentsSelectorsKitTypes.ModelSelectorComponent;
  type OAuthSelectorComponent = componentsSelectorsKitTypes.OAuthSelectorComponent;
  type ModelsCallbacks = componentsSelectorsKitTypes.ModelsCallbacks;
  type ModelsConfig = componentsSelectorsKitTypes.ModelsConfig;
  type ScopedModelsSelectorComponent = componentsSelectorsKitTypes.ScopedModelsSelectorComponent;
  type SessionSelectorComponent = componentsSelectorsKitTypes.SessionSelectorComponent;
  type SettingsCallbacks = componentsSelectorsKitTypes.SettingsCallbacks;
  type SettingsConfig = componentsSelectorsKitTypes.SettingsConfig;
  type SettingsSelectorComponent = componentsSelectorsKitTypes.SettingsSelectorComponent;
  type ShowImagesSelectorComponent = componentsSelectorsKitTypes.ShowImagesSelectorComponent;
  type SkillInvocationMessageComponent = componentsMessagesKitTypes.SkillInvocationMessageComponent;
  type ThemeSelectorComponent = componentsSelectorsKitTypes.ThemeSelectorComponent;
  type ThinkingSelectorComponent = componentsSelectorsKitTypes.ThinkingSelectorComponent;
  type ToolExecutionComponent = componentsMessagesKitTypes.ToolExecutionComponent;
  type ToolExecutionOptions = componentsMessagesKitTypes.ToolExecutionOptions;
  type TreeSelectorComponent = componentsSelectorsKitTypes.TreeSelectorComponent;
  type TrustSelectorComponent = componentsSelectorsKitTypes.TrustSelectorComponent;
  type UserMessageComponent = componentsMessagesKitTypes.UserMessageComponent;
  type UserMessageSelectorComponent = componentsDialogsKitTypes.UserMessageSelectorComponent;
  type VisualTruncateResult = componentsMessagesKitTypes.VisualTruncateResult;
}

export type { componentsTypes as default };
