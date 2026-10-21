import type tuiTypes from "@msa/tui/index.types";

import type footerDataProviderTypes from "../../../core/footer-data-provider.types.ts";
import expandableTextSupport from "../components/expandable-text-support.ts";
import keybindingHints from "../components/keybinding-hints.ts";
import type InteractiveMode from "../interactive-mode.ts";
import themeModule from "../theme/theme.ts";
import type themeTypes from "../theme/theme.types.ts";

const { theme } = themeModule;
const { isExpandable } = expandableTextSupport;
const { keyText } = keybindingHints;

export default class ExtensionChrome {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  resetExtensionUI(): void {
    this.mode.extensions.dialogs.extensionDialogs.close();
    this.mode.ui.hideOverlay();
    this.mode.extensions.dialogs.clearExtensionTerminalInputListeners();
    this.setExtensionFooter(undefined);
    this.setExtensionHeader(undefined);
    this.mode.layout.extensionWidgets.clear();
    this.mode.layout.footerDataProvider.clearExtensionStatuses();
    this.mode.footer.invalidate();
    this.mode.input.autocomplete.autocompleteProviderWrappers = [];
    this.mode.input.editors.setCustomEditorComponent(undefined);
    this.mode.input.autocomplete.setupAutocompleteProvider();
    this.mode.defaultEditor.onExtensionShortcut = undefined;
    this.mode.lifecycle.events.updateTerminalTitle();
    this.mode.display.indicator.workingMessage = undefined;
    this.mode.display.indicator.workingVisible = true;
    this.mode.display.indicator.setWorkingIndicator();
    if (this.mode.display.indicator.activeStatusIndicator?.kind === "working") {
      this.mode.display.indicator.activeStatusIndicator.setMessage(
        `${this.mode.display.indicator.defaultWorkingMessage} (${keyText("app.interrupt")} to interrupt)`,
      );
    }
    this.mode.display.thinking.setHiddenThinkingLabel();
  }

  setExtensionFooter(
    factory:
      | ((
          tui: tuiTypes.TUI,
          thm: themeTypes.Theme,
          footerData: footerDataProviderTypes.ReadonlyFooterDataProvider,
        ) => tuiTypes.Component & { dispose?(): void })
      | undefined,
  ): void {
    if (this.mode.layout.customFooter?.dispose !== undefined) {
      this.mode.layout.customFooter.dispose();
    }

    this.mode.layout.footerContainer.clear();
    if (factory === undefined) {
      this.mode.layout.customFooter = undefined;
      this.mode.layout.footerContainer.addChild(this.mode.footer);
    } else {
      this.mode.layout.customFooter = factory(
        this.mode.ui,
        theme,
        this.mode.layout.footerDataProvider,
      );
      this.mode.layout.footerContainer.addChild(this.mode.layout.customFooter);
    }

    this.mode.ui.requestRender();
  }

  setExtensionHeader(
    factory:
      | ((tui: tuiTypes.TUI, thm: themeTypes.Theme) => tuiTypes.Component & { dispose?(): void })
      | undefined,
  ): void {
    if (this.mode.layout.builtInHeader === undefined) {
      return;
    }

    if (this.mode.layout.customHeader?.dispose !== undefined) {
      this.mode.layout.customHeader.dispose();
    }

    const currentHeader = this.mode.layout.customHeader || this.mode.layout.builtInHeader;
    const index = this.mode.layout.headerContainer.children.indexOf(currentHeader);

    if (factory === undefined) {
      this.mode.layout.customHeader = undefined;
      if (isExpandable(this.mode.layout.builtInHeader)) {
        this.mode.layout.builtInHeader.setExpanded(this.mode.display.resources.toolOutputExpanded);
      }
      if (index !== -1) {
        this.mode.layout.headerContainer.children[index] = this.mode.layout.builtInHeader;
      }
    } else {
      this.mode.layout.customHeader = factory(this.mode.ui, theme);
      if (isExpandable(this.mode.layout.customHeader)) {
        this.mode.layout.customHeader.setExpanded(this.mode.display.resources.toolOutputExpanded);
      }
      if (index === -1) {
        this.mode.layout.headerContainer.children.unshift(this.mode.layout.customHeader);
      } else {
        this.mode.layout.headerContainer.children[index] = this.mode.layout.customHeader;
      }
    }

    this.mode.ui.requestRender();
  }
}
