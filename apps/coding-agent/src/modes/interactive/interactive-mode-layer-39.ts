import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type extensionsTypes from "../../core/extensions/index.types.ts";
import errorsModule from "../../utils/errors.ts";
import expandableTextSupport from "./components/expandable-text-support.ts";
import InteractiveModeLayer38 from "./interactive-mode-layer-38.ts";
import themeModule from "./theme/theme.ts";

const { setRegisteredThemes } = themeModule;
const { matchesKey } = tuiModule;
const { toErrorMessage } = errorsModule;
const { isExpandable } = expandableTextSupport;

export default abstract class InteractiveModeLayer39 extends InteractiveModeLayer38 {
  protected bindCurrentSessionExtensionsPart1(): void {
    setRegisteredThemes(this.session.resourceLoader.getThemes().themes);
    this.setupAutocompleteProvider();

    const extensionRunner = this.session.extensions.binding.extensionRunner;
    this.setupExtensionShortcuts(extensionRunner);
    this.showLoadedResources({ force: false, showDiagnosticsWhenQuiet: true });
    this.showStartupNoticesIfNeeded();
  }

  protected setupExtensionShortcuts(extensionRunner: extensionsTypes.ExtensionRunner): void {
    const shortcuts = extensionRunner.getShortcuts(this.keybindings.getEffectiveConfig());
    if (shortcuts.size === 0) return;

    const createContext = this.setupExtensionShortcutsCreateContext(extensionRunner);

    this.defaultEditor.onExtensionShortcut = (data: string) => {
      for (const [shortcutStr, shortcut] of shortcuts) {
        if (matchesKey(data, shortcutStr as tuiTypes.KeyId)) {
          Promise.resolve(shortcut.handler(createContext())).catch((err) => {
            this.showError(`Shortcut handler error: ${toErrorMessage(err)}`);
          });
          return true;
        }
      }
      return false;
    };
  }

  protected applyReloadedResources(): void {
    this.keybindings.reload();
    const activeHeader = this.customHeader ?? this.builtInHeader;
    if (isExpandable(activeHeader)) activeHeader.setExpanded(this.toolOutputExpanded);
    setRegisteredThemes(this.session.resourceLoader.getThemes().themes);
    this.applyRuntimeSettings();
    this.themeController.applyFromSettings();
    this.setupAutocompleteProvider();
    this.setupExtensionShortcuts(this.session.extensions.binding.extensionRunner);
    this.showLoadedResources({ force: false, showDiagnosticsWhenQuiet: true });
    const savedImplicitProjectTrust = this.maybeSaveImplicitProjectTrustAfterReload();
    const modelsJsonError = this.session.models.selection.modelRuntime.getError();
    if (modelsJsonError !== undefined && modelsJsonError !== "")
      this.showError(`models.json error: ${modelsJsonError}`);
    this.showStatus(
      savedImplicitProjectTrust
        ? "Reloaded keybindings, extensions, skills, prompts, themes, and context files; saved project trust"
        : "Reloaded keybindings, extensions, skills, prompts, themes, and context files",
    );
  }
}
