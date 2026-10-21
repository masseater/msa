import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import type extensionsTypes from "../../../core/extensions/index.types.ts";
import type keybindingsTypes from "../../../core/keybindings.types.ts";
import type interactiveModeInternalTypes from "../interactive-mode-internal.types.ts";
import type InteractiveMode from "../interactive-mode.ts";
import Theme from "../theme/theme-class.ts";
import themeModule from "../theme/theme.ts";
import type themeTypes from "../theme/theme.types.ts";

const { theme, getAvailableThemesWithPaths, getThemeByName } = themeModule;
const { awaited, awaitingWith } = awaitingModule;

export default class ExtensionUIContextFactory {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  private setExtensionStatus(key: string, text: string | undefined): void {
    this.mode.layout.footerDataProvider.setExtensionStatus(key, text);
    this.mode.ui.requestRender();
  }

  private setThemeFromExtension(
    themeOrName: Parameters<extensionsTypes.ExtensionUIContext["setTheme"]>[0],
  ): ReturnType<extensionsTypes.ExtensionUIContext["setTheme"]> {
    if (themeOrName instanceof Theme)
      return this.mode.display.theme.themeController.setThemeInstance(themeOrName);
    const result = this.mode.display.theme.themeController.setThemeName(themeOrName);
    if (result.success && this.mode.settingsManager.display.getTheme() !== themeOrName)
      this.mode.settingsManager.display.setTheme(themeOrName);
    return result;
  }

  private mountExtensionCustom(
    component: interactiveModeInternalTypes.CustomComponent,
    options: interactiveModeInternalTypes.ExtensionCustomOptions | undefined,
  ): void {
    if (options?.overlay !== true) {
      this.mode.editorSlot.disposeActiveSelector();
      this.mode.editorSlot.show(component);
      return;
    }
    const overlayOptions = options.overlayOptions;
    const width = (component as { width?: number }).width;
    const resolved =
      overlayOptions === undefined
        ? width !== undefined && width !== 0
          ? { width }
          : undefined
        : typeof overlayOptions === "function"
          ? overlayOptions()
          : overlayOptions;
    const handle = this.mode.ui.showOverlay(component, resolved);
    options.onHandle?.(handle);
  }

  createExtensionUIContext(): extensionsTypes.ExtensionUIContext {
    return {
      addAutocompleteProvider: (factory) => {
        this.mode.input.autocomplete.autocompleteProviderWrappers.push(factory);
        this.mode.input.autocomplete.setupAutocompleteProvider();
      },
      confirm: (title, message, opts) =>
        this.mode.extensions.dialogs.extensionDialogs.confirm(title, message, opts),
      custom: (factory, options) => this.showExtensionCustom(factory, options),
      editor: (title, prefill) =>
        this.mode.extensions.dialogs.extensionDialogs.editor(title, prefill),
      getAllThemes: () => getAvailableThemesWithPaths(),
      getEditorComponent: () => this.mode.input.editors.editorComponentFactory,
      getEditorText: () => this.mode.editor.getExpandedText?.() ?? this.mode.editor.getText(),
      getTheme: (name) => getThemeByName(name),
      getToolsExpanded: () => this.mode.display.resources.toolOutputExpanded,
      input: (title, placeholder, opts) =>
        this.mode.extensions.dialogs.extensionDialogs.input(title, placeholder, opts),
      notify: (message, type) => this.mode.display.status.showExtensionNotify(message, type),
      onTerminalInput: (handler) =>
        this.mode.extensions.dialogs.addExtensionTerminalInputListener(handler),
      pasteToEditor: (text) => this.mode.editor.handleInput(`\x1b[200~${text}\x1b[201~`),
      select: (title, options, opts) =>
        this.mode.extensions.dialogs.extensionDialogs.select(title, options, opts),
      setEditorComponent: (factory) => this.mode.input.editors.setCustomEditorComponent(factory),
      setEditorText: (text) => this.mode.editor.setText(text),
      setFooter: (factory) => this.mode.extensions.chrome.setExtensionFooter(factory),
      setHeader: (factory) => this.mode.extensions.chrome.setExtensionHeader(factory),
      setHiddenThinkingLabel: (label) => this.mode.display.thinking.setHiddenThinkingLabel(label),
      setStatus: (key, text) => this.setExtensionStatus(key, text),
      setTheme: (themeOrName) => this.setThemeFromExtension(themeOrName),
      setTitle: (title) => this.mode.ui.terminal.setTitle(title),
      setToolsExpanded: (expanded) => this.mode.display.resources.setToolsExpanded(expanded),
      setWidget: (key, content, options) =>
        this.mode.layout.extensionWidgets.set(key, content, options),
      setWorkingIndicator: (options) => this.mode.display.indicator.setWorkingIndicator(options),
      setWorkingMessage: (message) =>
        this.mode.display.indicator.setWorkingMessageFromExtension(message),
      setWorkingVisible: (visible) => this.mode.display.indicator.setWorkingVisible(visible),
      get theme() {
        return theme;
      },
    };
  }

  private createExtensionCustom<T>(
    factory: (
      tui: tuiTypes.TUI,
      theme: themeTypes.Theme,
      keybindings: keybindingsTypes.KeybindingsManager,
      done: (result: T) => void,
    ) =>
      | interactiveModeInternalTypes.CustomComponent
      | Promise<interactiveModeInternalTypes.CustomComponent>,
    close: (result: T) => void,
    mount: (created: interactiveModeInternalTypes.CustomComponent) => void,
    abandon: (error: unknown) => void,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      try {
        mount(yield* awaited(factory(this.mode.ui, theme, this.mode.keybindings, close)));
      } catch (error: unknown) {
        abandon(error);
      }
    }, this);
  }

  showExtensionCustom<T>(
    factory: (
      tui: tuiTypes.TUI,
      theme: themeTypes.Theme,
      keybindings: keybindingsTypes.KeybindingsManager,
      done: (result: T) => void,
    ) =>
      | interactiveModeInternalTypes.CustomComponent
      | Promise<interactiveModeInternalTypes.CustomComponent>,
    options?: interactiveModeInternalTypes.ExtensionCustomOptions,
  ): Promise<T> {
    return Effect.runPromise(
      Effect.callback<T>((resume) => {
        const savedText = this.mode.editor.getText();
        const isOverlay = options?.overlay ?? false;
        const restoreEditor = () => {
          this.mode.editor.setText(savedText);
          this.mode.editorSlot.restoreEditor();
        };
        let component: interactiveModeInternalTypes.CustomComponent | undefined;
        let closed = false;
        const close = (result: T) => {
          if (closed) return;
          closed = true;
          if (isOverlay) this.mode.ui.hideOverlay();
          else restoreEditor();
          resume(Effect.succeed(result));
          try {
            component?.dispose?.();
          } catch {}
        };
        const abandon = (error: unknown) => {
          if (closed) return;
          if (!isOverlay) restoreEditor();
          resume(Effect.die(error));
        };
        const mount = (created: interactiveModeInternalTypes.CustomComponent) => {
          if (closed) return;
          component = created;
          this.mountExtensionCustom(created, options);
        };
        Effect.runFork(this.createExtensionCustom(factory, close, mount, abandon));
      }),
    );
  }
}
