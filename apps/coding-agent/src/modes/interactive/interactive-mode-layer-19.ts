import type tuiTypes from "@msa/tui/index.types";

import type footerDataProviderTypes from "../../core/footer-data-provider.types.ts";
import goalModule from "../../core/goal.ts";
import type goalTypes from "../../core/goal.types.ts";
import platformModule from "../../core/platform.ts";
import expandableTextSupport from "./components/expandable-text-support.ts";
import keybindingHints from "./components/keybinding-hints.ts";
import InteractiveModeLayer18 from "./interactive-mode-layer-18.ts";
import themeModule from "./theme/theme.ts";
import type themeTypes from "./theme/theme.types.ts";

const { keyText } = keybindingHints;
const { theme } = themeModule;
const { isExpandable } = expandableTextSupport;
const { describeGoalStatus } = goalModule;
const { nowMs } = platformModule;

export default abstract class InteractiveModeLayer19 extends InteractiveModeLayer18 {
  protected resetExtensionUI(): void {
    this.extensionDialogs.close();
    this.ui.hideOverlay();
    this.clearExtensionTerminalInputListeners();
    this.setExtensionFooter(undefined);
    this.setExtensionHeader(undefined);
    this.extensionWidgets.clear();
    this.footerDataProvider.clearExtensionStatuses();
    this.footer.invalidate();
    this.autocompleteProviderWrappers = [];
    this.setCustomEditorComponent(undefined);
    this.setupAutocompleteProvider();
    this.defaultEditor.onExtensionShortcut = undefined;
    this.updateTerminalTitle();
    this.workingMessage = undefined;
    this.workingVisible = true;
    this.setWorkingIndicator();
    if (this.activeStatusIndicator?.kind === "working") {
      this.activeStatusIndicator.setMessage(
        `${this.defaultWorkingMessage} (${keyText("app.interrupt")} to interrupt)`,
      );
    }
    this.setHiddenThinkingLabel();
  }

  protected setExtensionFooter(
    factory:
      | ((
          tui: tuiTypes.TUI,
          thm: themeTypes.Theme,
          footerData: footerDataProviderTypes.ReadonlyFooterDataProvider,
        ) => tuiTypes.Component & { dispose?(): void })
      | undefined,
  ): void {
    if (this.customFooter?.dispose !== undefined) {
      this.customFooter.dispose();
    }

    this.footerContainer.clear();
    if (factory === undefined) {
      this.customFooter = undefined;
      this.footerContainer.addChild(this.footer);
    } else {
      this.customFooter = factory(this.ui, theme, this.footerDataProvider);
      this.footerContainer.addChild(this.customFooter);
    }

    this.ui.requestRender();
  }

  protected setExtensionHeader(
    factory:
      | ((tui: tuiTypes.TUI, thm: themeTypes.Theme) => tuiTypes.Component & { dispose?(): void })
      | undefined,
  ): void {
    if (this.builtInHeader === undefined) {
      return;
    }

    if (this.customHeader?.dispose !== undefined) {
      this.customHeader.dispose();
    }

    const currentHeader = this.customHeader || this.builtInHeader;
    const index = this.headerContainer.children.indexOf(currentHeader);

    if (factory === undefined) {
      this.customHeader = undefined;
      if (isExpandable(this.builtInHeader)) {
        this.builtInHeader.setExpanded(this.toolOutputExpanded);
      }
      if (index !== -1) {
        this.headerContainer.children[index] = this.builtInHeader;
      }
    } else {
      this.customHeader = factory(this.ui, theme);
      if (isExpandable(this.customHeader)) {
        this.customHeader.setExpanded(this.toolOutputExpanded);
      }
      if (index === -1) {
        this.headerContainer.children.unshift(this.customHeader);
      } else {
        this.headerContainer.children[index] = this.customHeader;
      }
    }

    this.ui.requestRender();
  }

  protected onGoalStatus(goal: goalTypes.GoalSnapshot | undefined): void {
    const [heading = "", ...rest] = describeGoalStatus(goal, nowMs());
    this.addMutedLines(() =>
      [
        goal === undefined ? theme.fg("muted", heading) : theme.fg("accent", theme.bold(heading)),
        ...rest.map((line) => theme.fg("muted", line)),
      ].join("\n"),
    );
  }
}
