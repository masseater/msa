import type InteractiveMode from "../interactive-mode.ts";
import ExtensionSessionBinding from "./extension-binding.ts";
import ExtensionChrome from "./extension-chrome.ts";
import ExtensionDialogsHost from "./extension-dialogs.ts";
import ExtensionUIContextFactory from "./extension-ui-context.ts";

export default class ModeExtensions {
  readonly ui: ExtensionUIContextFactory;
  readonly dialogs: ExtensionDialogsHost;
  readonly chrome: ExtensionChrome;
  readonly binding: ExtensionSessionBinding;

  constructor(mode: InteractiveMode) {
    this.ui = new ExtensionUIContextFactory(mode);
    this.dialogs = new ExtensionDialogsHost(mode);
    this.chrome = new ExtensionChrome(mode);
    this.binding = new ExtensionSessionBinding(mode);
  }
}
