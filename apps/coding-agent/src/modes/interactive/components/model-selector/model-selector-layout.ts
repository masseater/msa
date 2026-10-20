import tuiModule from "@msa/tui";

import themeModule from "../../theme/theme.ts";
import DynamicBorder from "../dynamic-border.ts";
import keybindingHints from "../keybinding-hints.ts";
import type ModelSelectorComponent from "../model-selector.ts";

const { theme } = themeModule;
const { keyDisplayText } = keybindingHints;
const { Spacer, Text, Container, Input } = tuiModule;

export default class ModelSelectorLayout {
  private readonly selector: ModelSelectorComponent;

  constructor(selector: ModelSelectorComponent) {
    this.selector = selector;
  }

  build(initialSearchInput: string | undefined): void {
    const { selector } = this;
    selector.addChild(new DynamicBorder());
    selector.addChild(new Spacer(1));
    this.addScopeHeader();
    selector.addChild(new Spacer(1));
    this.addSearchInput(initialSearchInput);
    selector.addChild(new Spacer(1));
    selector.listContainer = new Container();
    selector.addChild(selector.listContainer);
    selector.addChild(new Spacer(1));
    this.addFooter();
    selector.addChild(new DynamicBorder());
  }

  private addScopeHeader(): void {
    const { selector } = this;
    if (selector.scopedModels.length > 0 || selector.policyOptions !== undefined) {
      selector.scopeText = new Text(selector.list.getScopeText(), 0, 0);
      selector.addChild(selector.scopeText);
      selector.scopeHintText = new Text(selector.list.getScopeHintText(), 0, 0);
      selector.addChild(selector.scopeHintText);
    } else {
      const hintText =
        "Only showing models from configured providers. Use /login to add providers.";
      selector.addChild(new Text(theme.fg("warning", hintText), 0, 0));
    }
  }

  private addSearchInput(initialSearchInput: string | undefined): void {
    const { selector } = this;
    selector.searchInput = new Input();
    if (initialSearchInput !== undefined && initialSearchInput !== "") {
      selector.searchInput.setValue(initialSearchInput);
    }
    selector.searchInput.onSubmit = () => {
      const selected = selector.filteredModels[selector.selectedIndex];
      if (selected !== undefined) {
        selector.handleSelect(selected.model);
      }
    };
    selector.addChild(selector.searchInput);
  }

  private addFooter(): void {
    const { selector } = this;
    if (selector.onSelectAsDefaultCallback !== undefined) {
      selector.addChild(
        new Text(
          theme.fg(
            "dim",
            `  ${keyDisplayText("tui.select.confirm")} to select · ${keyDisplayText("app.models.save")} to set as default · ${keyDisplayText("tui.select.cancel")} to cancel`,
          ),
          0,
          0,
        ),
      );
    }
    if (selector.policyOptions !== undefined) {
      selector.policyHintText = new Text(selector.list.getPolicyHintText(), 0, 0);
      selector.addChild(selector.policyHintText);
    }
  }
}
