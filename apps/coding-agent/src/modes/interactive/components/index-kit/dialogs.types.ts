import type extensionEditorTypes from "../extension-editor.types.ts";
import type extensionInputTypes from "../extension-input.types.ts";
import type extensionSelectorTypes from "../extension-selector.types.ts";
import type firstTimeSetupTypes from "../first-time-setup.types.ts";
import type loginDialogTypes from "../login-dialog.types.ts";
import type userMessageSelectorTypes from "../user-message-selector.types.ts";

declare namespace componentsDialogsKitTypes {
  type ExtensionEditorComponent = extensionEditorTypes.ExtensionEditorComponent;
  type ExtensionInputComponent = extensionInputTypes.ExtensionInputComponent;
  type ExtensionSelectorComponent = extensionSelectorTypes.ExtensionSelectorComponent;
  type FirstTimeSetupComponent = firstTimeSetupTypes.FirstTimeSetupComponent;
  type FirstTimeSetupOptions = firstTimeSetupTypes.FirstTimeSetupOptions;
  type FirstTimeSetupResult = firstTimeSetupTypes.FirstTimeSetupResult;
  type LoginDialogComponent = loginDialogTypes.LoginDialogComponent;
  type UserMessageSelectorComponent = userMessageSelectorTypes.UserMessageSelectorComponent;
}

export type { componentsDialogsKitTypes as default };
