import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type extensionsTypes from "../../../core/extensions/index.types.ts";
import KeybindingsManager from "../../../core/keybindings-manager.ts";
import CustomEditor from "../components/custom-editor.ts";
import type InteractiveMode from "../interactive-mode.ts";
import themeModule from "../theme/theme.ts";

const { getEditorTheme } = themeModule;
const { setKeybindings } = tuiModule;

export default class EditorComponents {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  editorComponentFactory!: extensionsTypes.EditorFactory | undefined;

  clearEditor(): void {
    this.mode.editor.setText("");
    this.mode.ui.requestRender();
  }

  createKeybindings() {
    const keybindings = KeybindingsManager.create();
    setKeybindings(keybindings);
    return keybindings;
  }

  createDefaultEditor() {
    return new CustomEditor(this.mode.ui, getEditorTheme(), this.mode.keybindings, {
      autocompleteMaxVisible: this.mode.settingsManager.getAutocompleteMaxVisible(),
      embedWorkingStatus: true,
      paddingX: this.mode.settingsManager.getEditorPaddingX(),
    });
  }

  private adoptDefaultEditorHandlers(
    customEditor: Record<string, unknown>,
    newEditor: tuiTypes.EditorComponent,
  ): void {
    if ("actionHandlers" in customEditor && customEditor["actionHandlers"] instanceof Map) {
      if (customEditor["onEscape"] === undefined) {
        customEditor["onEscape"] = () => this.mode.defaultEditor.onEscape?.();
      }
      if (customEditor["onCtrlD"] === undefined) {
        customEditor["onCtrlD"] = () => this.mode.defaultEditor.onCtrlD?.();
      }
      if (customEditor["onPasteImage"] === undefined) {
        customEditor["onPasteImage"] = () => this.mode.defaultEditor.onPasteImage?.();
      }
      if (customEditor["onExtensionShortcut"] === undefined) {
        customEditor["onExtensionShortcut"] = (data: string) =>
          this.mode.defaultEditor.onExtensionShortcut?.(data);
      }
      for (const [action, handler] of this.mode.defaultEditor.actionHandlers) {
        (customEditor["actionHandlers"] as Map<string, () => void>).set(action, handler);
      }
    }

    this.mode.editor = newEditor;
  }

  setCustomEditorComponent(factory: extensionsTypes.EditorFactory | undefined): void {
    this.editorComponentFactory = factory;

    const currentText = this.mode.editor.getText();

    this.mode.editorSlot.disposeActiveSelector();

    if (factory === undefined) {
      this.mode.defaultEditor.setText(currentText);
      this.mode.editor = this.mode.defaultEditor;
    } else {
      const { customEditor, newEditor } = this.createCustomEditor(factory, currentText);
      this.adoptDefaultEditorHandlers(customEditor, newEditor);
    }

    if (this.mode.display.indicator.activeStatusIndicator !== undefined) {
      this.mode.layout.statusContainer.clear();
      this.mode.display.indicator.activeWorkingIndicatorEmbedded =
        this.mode.display.indicator.setEditorWorkingStatusIndicator(
          this.mode.display.indicator.activeStatusIndicator,
        );
      if (!this.mode.display.indicator.activeWorkingIndicatorEmbedded) {
        this.mode.layout.statusContainer.addChild(
          this.mode.display.indicator.activeStatusIndicator,
        );
      }
    }
    this.mode.editorSlot.show(this.mode.editor);
  }

  private createCustomEditor(
    factory: extensionsTypes.EditorFactory,
    currentText: string,
  ): { customEditor: Record<string, unknown>; newEditor: tuiTypes.EditorComponent } {
    const newEditor = factory(this.mode.ui, getEditorTheme(), this.mode.keybindings);

    if (this.mode.defaultEditor.onSubmit !== undefined)
      newEditor.onSubmit = this.mode.defaultEditor.onSubmit;
    if (this.mode.defaultEditor.onChange !== undefined)
      newEditor.onChange = this.mode.defaultEditor.onChange;

    newEditor.setText(currentText);

    if (newEditor.borderColor !== undefined) {
      newEditor.borderColor = this.mode.defaultEditor.borderColor;
    }
    if (newEditor.setPaddingX !== undefined) {
      newEditor.setPaddingX(this.mode.defaultEditor.getPaddingX());
    }
    if (newEditor.setAutocompleteMaxVisible !== undefined) {
      newEditor.setAutocompleteMaxVisible(this.mode.defaultEditor.getAutocompleteMaxVisible());
    }

    if (
      newEditor.setAutocompleteProvider !== undefined &&
      this.mode.input.autocomplete.autocompleteProvider !== undefined
    ) {
      newEditor.setAutocompleteProvider(this.mode.input.autocomplete.autocompleteProvider);
    }

    const customEditor = newEditor as unknown as Record<string, unknown>;
    return { customEditor, newEditor };
  }
}
