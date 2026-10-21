import ai from "@msa/ai";
import tuiModule from "@msa/tui";

import modelSearch from "../../model-search.ts";
import themeModule from "../../theme/theme.ts";
import keybindingHints from "../keybinding-hints.ts";
import type ModelSelectorComponent from "../model-selector.ts";

const { modelsAreEqual } = ai;
const { theme } = themeModule;
const { keyDisplayText, keyHint } = keybindingHints;
const { Spacer, Text, fuzzyFilter } = tuiModule;
const { getModelSelectorSearchText } = modelSearch;

export default class ModelList {
  private readonly selector: ModelSelectorComponent;

  constructor(selector: ModelSelectorComponent) {
    this.selector = selector;
  }

  getScopeText(): string {
    const labels = this.selector.catalog
      .availableScopes()
      .map((scope) =>
        scope === this.selector.scope ? theme.fg("accent", scope) : theme.fg("muted", scope),
      );
    return `${theme.fg("muted", "Scope: ")}${labels.join(theme.fg("muted", " | "))}`;
  }

  getScopeHintText(): string {
    return keyHint("tui.input.tab", "scope");
  }

  getPolicyHintText(): string {
    const selected = this.selector.filteredModels[this.selector.selectedIndex];
    const verb = selected?.deniedBy === undefined ? "deny" : "allow";
    return theme.fg(
      "dim",
      `  ${keyDisplayText("app.models.policy")} ${verb} · ${keyDisplayText("app.models.toggleProvider")} provider`,
    );
  }

  private isDefaultSearch(query: string): boolean {
    const normalized = query.trim().toLowerCase();
    return normalized.length > 0 && "default".startsWith(normalized);
  }

  filterModels(query: string): void {
    if (query === "") {
      this.selector.filteredModels = this.selector.activeModels;
    } else {
      const filtered = fuzzyFilter(this.selector.activeModels, query, (item) => {
        const defaultText = this.selector.catalog.isDefaultModel(item.model) ? " default" : "";
        return `${getModelSelectorSearchText({ id: item.id, name: item.model.name, provider: item.provider })}${defaultText}`;
      });
      if (this.isDefaultSearch(query)) {
        const defaultItems = this.selector.activeModels.filter((item) =>
          this.selector.catalog.isDefaultModel(item.model),
        );
        const defaultKeys = new Set(defaultItems.map((item) => `${item.provider}\0${item.id}`));
        this.selector.filteredModels = [
          ...defaultItems,
          ...filtered.filter((item) => !defaultKeys.has(`${item.provider}\0${item.id}`)),
        ];
      } else {
        this.selector.filteredModels = filtered;
      }
    }

    this.selector.selectedIndex =
      query === ""
        ? Math.min(
            this.selector.selectedIndex,
            Math.max(0, this.selector.filteredModels.length - 1),
          )
        : 0;
    this.updateList();
  }

  updateList(): void {
    this.selector.listContainer.clear();

    const maxVisible = 10;
    const startIndex = Math.max(
      0,
      Math.min(
        this.selector.selectedIndex - Math.floor(maxVisible / 2),
        this.selector.filteredModels.length - maxVisible,
      ),
    );
    const endIndex = Math.min(startIndex + maxVisible, this.selector.filteredModels.length);

    this.renderModelRows(startIndex, endIndex);

    if (this.selector.errorMessage !== undefined && this.selector.errorMessage !== "") {
      const errorLines = this.selector.errorMessage.split("\n");
      for (const line of errorLines) {
        this.selector.listContainer.addChild(new Text(theme.fg("error", line), 0, 0));
      }
    } else if (this.selector.filteredModels.length === 0) {
      this.selector.listContainer.addChild(
        new Text(theme.fg("muted", "  No matching models"), 0, 0),
      );
    } else {
      const selected = this.selector.filteredModels[this.selector.selectedIndex];
      if (selected !== undefined) {
        this.selector.listContainer.addChild(new Spacer(1));
        this.selector.listContainer.addChild(
          new Text(theme.fg("muted", `  Model Name: ${selected.model.name}`), 0, 0),
        );
      }
    }
    this.selector.policyHintText?.setText(this.getPolicyHintText());
    if (this.selector.refreshStatusMessage !== "") {
      this.selector.listContainer.addChild(new Spacer(1));
      this.selector.listContainer.addChild(
        new Text(
          theme.fg(
            this.selector.refreshStatusSuccess ? "success" : "muted",
            `  ${this.selector.refreshStatusMessage}`,
          ),
          0,
          0,
        ),
      );
    }
  }

  private renderModelRows(startIndex: number, endIndex: number) {
    for (let i = startIndex; i < endIndex; i++) {
      const item = this.selector.filteredModels[i];
      if (item === undefined) continue;

      const isSelected = i === this.selector.selectedIndex;
      const isCurrent = modelsAreEqual(this.selector.currentModel, item.model);
      const isDefault = this.selector.catalog.isDefaultModel(item.model);
      const defaultBadge = isDefault ? theme.fg("muted", " · default") : "";
      const denied = item.deniedBy !== undefined;

      const cursor = isSelected ? theme.fg("accent", "→ ") : "  ";
      const currentMarker = denied
        ? theme.fg("warning", "✕ ")
        : isCurrent
          ? theme.fg("accent", "✓ ")
          : "  ";
      const plainId = denied ? theme.fg("dim", theme.strikethrough(item.id)) : item.id;
      const modelText = isSelected ? theme.fg("accent", plainId) : plainId;
      const providerBadge = theme.fg("muted", `[${item.provider}]`);
      const deniedBadge = denied ? theme.fg("warning", ` · ${item.deniedBy || "allow list"}`) : "";
      const line = `${cursor}${currentMarker}${modelText} ${providerBadge}${defaultBadge}${deniedBadge}`;

      this.selector.listContainer.addChild(new Text(line, 0, 0));
    }

    if (startIndex > 0 || endIndex < this.selector.filteredModels.length) {
      const scrollInfo = theme.fg(
        "muted",
        `  (${this.selector.selectedIndex + 1}/${this.selector.filteredModels.length})`,
      );
      this.selector.listContainer.addChild(new Text(scrollInfo, 0, 0));
    }
  }
}
