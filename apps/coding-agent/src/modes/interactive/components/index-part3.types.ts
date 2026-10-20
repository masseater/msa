import type scopedModelsSelectorTypes from "./scoped-models-selector.types.ts";
import type sessionSelectorTypes from "./session-selector.types.ts";
import type settingsSelectorTypes from "./settings-selector.types.ts";
import type showImagesSelectorTypes from "./show-images-selector.types.ts";
import type skillInvocationMessageTypes from "./skill-invocation-message.types.ts";
import type themeSelectorTypes from "./theme-selector.types.ts";
import type thinkingSelectorTypes from "./thinking-selector.types.ts";
import type toolExecutionTypes from "./tool-execution.types.ts";
import type treeSelectorTypes from "./tree-selector.types.ts";

declare namespace componentsTypesPart3 {
  type ModelsCallbacks = scopedModelsSelectorTypes.ModelsCallbacks;
  type ModelsConfig = scopedModelsSelectorTypes.ModelsConfig;
  type ScopedModelsSelectorComponent = scopedModelsSelectorTypes.ScopedModelsSelectorComponent;
  type SessionSelectorComponent = sessionSelectorTypes.SessionSelectorComponent;
  type SettingsCallbacks = settingsSelectorTypes.SettingsCallbacks;
  type SettingsConfig = settingsSelectorTypes.SettingsConfig;
  type SettingsSelectorComponent = settingsSelectorTypes.SettingsSelectorComponent;
  type ShowImagesSelectorComponent = showImagesSelectorTypes.ShowImagesSelectorComponent;
  type SkillInvocationMessageComponent =
    skillInvocationMessageTypes.SkillInvocationMessageComponent;
  type ThemeSelectorComponent = themeSelectorTypes.ThemeSelectorComponent;
  type ThinkingSelectorComponent = thinkingSelectorTypes.ThinkingSelectorComponent;
  type ToolExecutionComponent = toolExecutionTypes.ToolExecutionComponent;
  type ToolExecutionOptions = toolExecutionTypes.ToolExecutionOptions;
  type TreeSelectorComponent = treeSelectorTypes.TreeSelectorComponent;
}

export type { componentsTypesPart3 as default };
