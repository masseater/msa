import type modelSelectorTypes from "../model-selector.types.ts";
import type oauthSelectorTypes from "../oauth-selector.types.ts";
import type scopedModelsSelectorTypes from "../scoped-models-selector.types.ts";
import type sessionSelectorTypes from "../session-selector.types.ts";
import type settingsSelectorTypes from "../settings-selector.types.ts";
import type showImagesSelectorTypes from "../show-images-selector.types.ts";
import type themeSelectorTypes from "../theme-selector.types.ts";
import type thinkingSelectorTypes from "../thinking-selector.types.ts";
import type treeSelectorTypes from "../tree-selector.types.ts";
import type trustSelectorTypes from "../trust-selector.types.ts";

declare namespace componentsSelectorsKitTypes {
  type ModelSelectorComponent = modelSelectorTypes.ModelSelectorComponent;
  type OAuthSelectorComponent = oauthSelectorTypes.OAuthSelectorComponent;
  type ModelsCallbacks = scopedModelsSelectorTypes.ModelsCallbacks;
  type ModelsConfig = scopedModelsSelectorTypes.ModelsConfig;
  type ScopedModelsSelectorComponent = scopedModelsSelectorTypes.ScopedModelsSelectorComponent;
  type SessionSelectorComponent = sessionSelectorTypes.SessionSelectorComponent;
  type SettingsCallbacks = settingsSelectorTypes.SettingsCallbacks;
  type SettingsConfig = settingsSelectorTypes.SettingsConfig;
  type SettingsSelectorComponent = settingsSelectorTypes.SettingsSelectorComponent;
  type ShowImagesSelectorComponent = showImagesSelectorTypes.ShowImagesSelectorComponent;
  type ThemeSelectorComponent = themeSelectorTypes.ThemeSelectorComponent;
  type ThinkingSelectorComponent = thinkingSelectorTypes.ThinkingSelectorComponent;
  type TreeSelectorComponent = treeSelectorTypes.TreeSelectorComponent;
  type TrustSelectorComponent = trustSelectorTypes.TrustSelectorComponent;
}

export type { componentsSelectorsKitTypes as default };
