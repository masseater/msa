import ExtensionDialogs from "../extension-dialogs.ts";
import type extensionDialogsTypes from "../extension-dialogs.types.ts";
import type InteractiveMode from "../interactive-mode.ts";

export default class ExtensionDialogsHost {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  extensionDialogs!: extensionDialogsTypes.ExtensionDialogs;

  private extensionTerminalInputSubscriptions = new Set<{
    handler: (data: string) => { consume?: boolean; data?: string } | undefined;
    unsubscribe: () => void;
  }>();

  addExtensionTerminalInputListener(
    handler: (data: string) => { consume?: boolean; data?: string } | undefined,
  ): () => void {
    const subscription = { handler, unsubscribe: this.mode.ui.addInputListener(handler) };
    this.extensionTerminalInputSubscriptions.add(subscription);
    return () => {
      subscription.unsubscribe();
      this.extensionTerminalInputSubscriptions.delete(subscription);
    };
  }

  rebindExtensionTerminalInputListeners(): void {
    for (const subscription of this.extensionTerminalInputSubscriptions) {
      subscription.unsubscribe();
      subscription.unsubscribe = this.mode.ui.addInputListener(subscription.handler);
    }
  }

  clearExtensionTerminalInputListeners(): void {
    for (const subscription of this.extensionTerminalInputSubscriptions) subscription.unsubscribe();
    this.extensionTerminalInputSubscriptions.clear();
  }

  start(): void {
    this.extensionDialogs = this.createExtensionDialogs();
  }

  private createExtensionDialogs() {
    return new ExtensionDialogs({
      editorSlot: this.mode.editorSlot,
      getExternalEditorCommand: () => this.mode.settingsManager.terminal.getExternalEditorCommand(),
      keybindings: this.mode.keybindings,
      programStatus: this.mode.layout.programStatus,
      toggleToolsExpanded: () => this.mode.display.resources.toggleToolOutputExpansion(),
      ui: this.mode.ui,
    });
  }
}
