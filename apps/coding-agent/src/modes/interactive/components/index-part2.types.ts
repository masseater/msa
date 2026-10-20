import type dynamicBorderTypes from "./dynamic-border.types.ts";
import type extensionEditorTypes from "./extension-editor.types.ts";
import type extensionInputTypes from "./extension-input.types.ts";
import type extensionSelectorTypes from "./extension-selector.types.ts";
import type firstTimeSetupTypes from "./first-time-setup.types.ts";
import type footerTypes from "./footer.types.ts";
import type loginDialogTypes from "./login-dialog.types.ts";
import type modelSelectorTypes from "./model-selector.types.ts";
import type oauthSelectorTypes from "./oauth-selector.types.ts";

declare namespace componentsTypesPart2 {
  type DynamicBorder = dynamicBorderTypes.DynamicBorder;
  type ExtensionEditorComponent = extensionEditorTypes.ExtensionEditorComponent;
  type ExtensionInputComponent = extensionInputTypes.ExtensionInputComponent;
  type ExtensionSelectorComponent = extensionSelectorTypes.ExtensionSelectorComponent;
  type FirstTimeSetupComponent = firstTimeSetupTypes.FirstTimeSetupComponent;
  type FirstTimeSetupOptions = firstTimeSetupTypes.FirstTimeSetupOptions;
  type FirstTimeSetupResult = firstTimeSetupTypes.FirstTimeSetupResult;
  type FooterComponent = footerTypes.FooterComponent;
  type LoginDialogComponent = loginDialogTypes.LoginDialogComponent;
  type ModelSelectorComponent = modelSelectorTypes.ModelSelectorComponent;
  type OAuthSelectorComponent = oauthSelectorTypes.OAuthSelectorComponent;
}

export type { componentsTypesPart2 as default };
