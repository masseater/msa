import ModelSelectorComponent from "../model-selector.ts";
import OAuthSelectorComponent from "../oauth-selector.ts";
import ScopedModelsSelectorComponent from "../scoped-models-selector.ts";
import SessionSelectorComponent from "../session-selector.ts";
import SettingsSelectorComponent from "../settings-selector.ts";
import ShowImagesSelectorComponent from "../show-images-selector.ts";
import ThemeSelectorComponent from "../theme-selector.ts";
import ThinkingSelectorComponent from "../thinking-selector.ts";
import TreeSelectorComponent from "../tree-selector.ts";
import TrustSelectorComponent from "../trust-selector.ts";

const selectorsKit: {
  readonly ModelSelectorComponent: typeof ModelSelectorComponent;
  readonly OAuthSelectorComponent: typeof OAuthSelectorComponent;
  readonly ScopedModelsSelectorComponent: typeof ScopedModelsSelectorComponent;
  readonly SessionSelectorComponent: typeof SessionSelectorComponent;
  readonly SettingsSelectorComponent: typeof SettingsSelectorComponent;
  readonly ShowImagesSelectorComponent: typeof ShowImagesSelectorComponent;
  readonly ThemeSelectorComponent: typeof ThemeSelectorComponent;
  readonly ThinkingSelectorComponent: typeof ThinkingSelectorComponent;
  readonly TreeSelectorComponent: typeof TreeSelectorComponent;
  readonly TrustSelectorComponent: typeof TrustSelectorComponent;
} = {
  ModelSelectorComponent,
  OAuthSelectorComponent,
  ScopedModelsSelectorComponent,
  SessionSelectorComponent,
  SettingsSelectorComponent,
  ShowImagesSelectorComponent,
  ThemeSelectorComponent,
  ThinkingSelectorComponent,
  TreeSelectorComponent,
  TrustSelectorComponent,
};

export default selectorsKit;
