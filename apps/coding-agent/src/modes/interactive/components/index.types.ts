import type componentsTypesPart1 from "./index-part1.types.ts";
import type componentsTypesPart2 from "./index-part2.types.ts";
import type componentsTypesPart3 from "./index-part3.types.ts";
import type componentsTypesPart4 from "./index-part4.types.ts";

declare namespace componentsTypes {
  type ArminComponent = componentsTypesPart1.ArminComponent;
  type AssistantMessageComponent = componentsTypesPart1.AssistantMessageComponent;
  type BashExecutionComponent = componentsTypesPart1.BashExecutionComponent;
  type BorderedLoader = componentsTypesPart1.BorderedLoader;
  type BranchSummaryMessageComponent = componentsTypesPart1.BranchSummaryMessageComponent;
  type CompactionSummaryMessageComponent = componentsTypesPart1.CompactionSummaryMessageComponent;
  type CustomEditor = componentsTypesPart1.CustomEditor;
  type CustomEditorOptions = componentsTypesPart1.CustomEditorOptions;
  type CustomMessageComponent = componentsTypesPart1.CustomMessageComponent;
  type RenderDiffOptions = componentsTypesPart1.RenderDiffOptions;
  type DynamicBorder = componentsTypesPart2.DynamicBorder;
  type ExtensionEditorComponent = componentsTypesPart2.ExtensionEditorComponent;
  type ExtensionInputComponent = componentsTypesPart2.ExtensionInputComponent;
  type ExtensionSelectorComponent = componentsTypesPart2.ExtensionSelectorComponent;
  type FirstTimeSetupComponent = componentsTypesPart2.FirstTimeSetupComponent;
  type FirstTimeSetupOptions = componentsTypesPart2.FirstTimeSetupOptions;
  type FirstTimeSetupResult = componentsTypesPart2.FirstTimeSetupResult;
  type FooterComponent = componentsTypesPart2.FooterComponent;
  type LoginDialogComponent = componentsTypesPart2.LoginDialogComponent;
  type ModelSelectorComponent = componentsTypesPart2.ModelSelectorComponent;
  type OAuthSelectorComponent = componentsTypesPart2.OAuthSelectorComponent;
  type ModelsCallbacks = componentsTypesPart3.ModelsCallbacks;
  type ModelsConfig = componentsTypesPart3.ModelsConfig;
  type ScopedModelsSelectorComponent = componentsTypesPart3.ScopedModelsSelectorComponent;
  type SessionSelectorComponent = componentsTypesPart3.SessionSelectorComponent;
  type SettingsCallbacks = componentsTypesPart3.SettingsCallbacks;
  type SettingsConfig = componentsTypesPart3.SettingsConfig;
  type SettingsSelectorComponent = componentsTypesPart3.SettingsSelectorComponent;
  type ShowImagesSelectorComponent = componentsTypesPart3.ShowImagesSelectorComponent;
  type SkillInvocationMessageComponent = componentsTypesPart3.SkillInvocationMessageComponent;
  type ThemeSelectorComponent = componentsTypesPart3.ThemeSelectorComponent;
  type ThinkingSelectorComponent = componentsTypesPart3.ThinkingSelectorComponent;
  type ToolExecutionComponent = componentsTypesPart3.ToolExecutionComponent;
  type ToolExecutionOptions = componentsTypesPart3.ToolExecutionOptions;
  type TreeSelectorComponent = componentsTypesPart3.TreeSelectorComponent;
  type TrustSelectorComponent = componentsTypesPart4.TrustSelectorComponent;
  type UserMessageComponent = componentsTypesPart4.UserMessageComponent;
  type UserMessageSelectorComponent = componentsTypesPart4.UserMessageSelectorComponent;
  type VisualTruncateResult = componentsTypesPart4.VisualTruncateResult;
}

export type { componentsTypes as default };
