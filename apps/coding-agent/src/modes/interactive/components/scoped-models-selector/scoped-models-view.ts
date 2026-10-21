import tui from "@msa/tui";

import themeModule from "../../theme/theme.ts";
import DynamicBorder from "../dynamic-border.ts";
import keybindingHints from "../keybinding-hints.ts";
import scopedModelsSelectorHelpers from "../scoped-models-selector-helpers.ts";
import type scopedModelsSelectorInternalTypes from "../scoped-models-selector-internal.types.ts";
import type ScopedModelsSelectorComponent from "../scoped-models-selector.ts";

const { theme } = themeModule;
const { keyDisplayText } = keybindingHints;
const { Container, Input, Spacer, Text } = tui;
const { getSortedIds, isEnabled } = scopedModelsSelectorHelpers;

export default class ScopedModelsView {
  private readonly selector: ScopedModelsSelectorComponent;

  constructor(selector: ScopedModelsSelectorComponent) {
    this.selector = selector;
  }

  buildItems(): scopedModelsSelectorInternalTypes.ModelItem[] {
    return getSortedIds(this.selector.enabledIds, this.selector.allIds).map((id) => ({
      enabled: isEnabled(this.selector.enabledIds, id),
      fullId: id,
      model: this.selector.modelsById.get(id),
    }));
  }

  getFooterText(): string {
    const enabledCount =
      this.selector.enabledIds?.filter((id) => this.selector.modelsById.has(id)).length ??
      this.selector.allIds.length;
    const unavailableCount =
      this.selector.enabledIds?.filter((id) => !this.selector.modelsById.has(id)).length ?? 0;
    const allEnabled = this.selector.enabledIds === null;
    const countText = allEnabled
      ? "all enabled"
      : `${enabledCount}/${this.selector.allIds.length} enabled${unavailableCount === 0 ? "" : ` · ${unavailableCount} unavailable`}`;
    const parts = [
      `${keyDisplayText("tui.select.confirm")} toggle`,
      `${keyDisplayText("app.models.enableAll")} all`,
      `${keyDisplayText("app.models.clearAll")} clear`,
      `${keyDisplayText("app.models.toggleProvider")} provider`,
      `${keyDisplayText("app.models.reorderUp")}/${keyDisplayText("app.models.reorderDown")} reorder`,
      `${keyDisplayText("app.models.save")} save`,
      countText,
    ];
    return this.selector.isDirty
      ? theme.fg("dim", `  ${parts.join(" · ")} `) + theme.fg("warning", "(unsaved)")
      : theme.fg("dim", `  ${parts.join(" · ")}`);
  }

  updateList(): void {
    this.selector.listContainer.clear();

    if (this.selector.filteredItems.length === 0) {
      this.selector.listContainer.addChild(
        new Text(theme.fg("muted", "  No matching models"), 0, 0),
      );
      return;
    }

    const selected = this.renderRows();
    if (selected !== undefined) {
      this.selector.listContainer.addChild(new Spacer(1));
      this.selector.listContainer.addChild(
        new Text(
          theme.fg(
            "muted",
            `  ${selected.model === undefined ? "Model unavailable" : `Model Name: ${selected.model.name}`}`,
          ),
          0,
          0,
        ),
      );
    }
  }

  renderRows(): scopedModelsSelectorInternalTypes.ModelItem | undefined {
    const startIndex = Math.max(
      0,
      Math.min(
        this.selector.selectedIndex - Math.floor(this.selector.maxVisible / 2),
        this.selector.filteredItems.length - this.selector.maxVisible,
      ),
    );
    const endIndex = Math.min(
      startIndex + this.selector.maxVisible,
      this.selector.filteredItems.length,
    );
    for (let i = startIndex; i < endIndex; i++) {
      const item = this.selector.filteredItems[i]!;
      const isSelected = i === this.selector.selectedIndex;
      const prefix = isSelected ? theme.fg("accent", "→ ") : "  ";
      const id = item.model?.id ?? item.fullId;
      const styledId = item.model === undefined ? theme.strikethrough(id) : id;
      const modelText = isSelected ? theme.fg("accent", styledId) : styledId;
      const providerBadge = theme.fg(
        "muted",
        item.model === undefined ? " [unavailable]" : ` [${item.model.provider}]`,
      );
      const status = item.model !== undefined && item.enabled ? theme.fg("accent", "✓ ") : "  ";
      this.selector.listContainer.addChild(
        new Text(`${prefix}${status}${modelText}${providerBadge}`, 0, 0),
      );
    }

    if (startIndex > 0 || endIndex < this.selector.filteredItems.length) {
      this.selector.listContainer.addChild(
        new Text(
          theme.fg(
            "muted",
            `  (${this.selector.selectedIndex + 1}/${this.selector.filteredItems.length})`,
          ),
          0,
          0,
        ),
      );
    }

    const selected = this.selector.filteredItems[this.selector.selectedIndex];
    return selected;
  }

  build(refreshStatus: string | undefined): void {
    this.selector.addChild(new DynamicBorder());
    this.selector.addChild(new Spacer(1));
    this.selector.addChild(new Text(theme.fg("accent", theme.bold("Model Configuration")), 0, 0));
    this.selector.addChild(
      new Text(
        theme.fg(
          "muted",
          `Session-only. ${keyDisplayText("app.models.save")} to save to settings.`,
        ),
        0,
        0,
      ),
    );
    this.selector.addChild(new Spacer(1));

    this.selector.searchInput = new Input();
    this.selector.addChild(this.selector.searchInput);
    this.selector.addChild(new Spacer(1));

    this.selector.listContainer = new Container();
    this.selector.addChild(this.selector.listContainer);

    this.selector.addChild(new Spacer(1));
    if (refreshStatus !== undefined && refreshStatus !== "") {
      this.selector.refreshStatusText = new Text(theme.fg("muted", `  ${refreshStatus}`), 0, 0);
      this.selector.addChild(this.selector.refreshStatusText);
    }
    this.selector.footerText = new Text(this.getFooterText(), 0, 0);
    this.selector.addChild(this.selector.footerText);

    this.selector.addChild(new DynamicBorder());
  }
}
