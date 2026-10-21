import ExtensionEditorComponent from "../extension-editor.ts";
import ExtensionInputComponent from "../extension-input.ts";
import ExtensionSelectorComponent from "../extension-selector.ts";
import FirstTimeSetupComponent from "../first-time-setup.ts";
import LoginDialogComponent from "../login-dialog.ts";
import UserMessageSelectorComponent from "../user-message-selector.ts";

const dialogsKit: {
  readonly ExtensionEditorComponent: typeof ExtensionEditorComponent;
  readonly ExtensionInputComponent: typeof ExtensionInputComponent;
  readonly ExtensionSelectorComponent: typeof ExtensionSelectorComponent;
  readonly FirstTimeSetupComponent: typeof FirstTimeSetupComponent;
  readonly LoginDialogComponent: typeof LoginDialogComponent;
  readonly UserMessageSelectorComponent: typeof UserMessageSelectorComponent;
} = {
  ExtensionEditorComponent,
  ExtensionInputComponent,
  ExtensionSelectorComponent,
  FirstTimeSetupComponent,
  LoginDialogComponent,
  UserMessageSelectorComponent,
};

export default dialogsKit;
