import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import themeModule from "../theme/theme.ts";
import DynamicBorder from "./dynamic-border.ts";
import keybindingHints from "./keybinding-hints.ts";
import type scopedModelsSelectorInternalTypes from "./scoped-models-selector-internal.types.ts";
import ScopedModelsSelectorComponentLayer1 from "./scoped-models-selector-layer-1.ts";
import type scopedModelsSelectorTypes from "./scoped-models-selector.types.ts";

const { Container, Input, Spacer, Text } = tui;
const { theme } = themeModule;
const { keyDisplayText } = keybindingHints;

export default class ScopedModelsSelectorComponent
  extends ScopedModelsSelectorComponentLayer1
  implements tuiTypes.Focusable
{
  static updateListSelected(
    self: ScopedModelsSelectorComponent,
  ): scopedModelsSelectorInternalTypes.ModelItem | undefined {
    const startIndex = Math.max(
      0,
      Math.min(
        self.selectedIndex - Math.floor(self.maxVisible / 2),
        self.filteredItems.length - self.maxVisible,
      ),
    );
    const endIndex = Math.min(startIndex + self.maxVisible, self.filteredItems.length);
    for (let i = startIndex; i < endIndex; i++) {
      const item = self.filteredItems[i]!;
      const isSelected = i === self.selectedIndex;
      const prefix = isSelected ? theme.fg("accent", "→ ") : "  ";
      const id = item.model?.id ?? item.fullId;
      const styledId = item.model === undefined ? theme.strikethrough(id) : id;
      const modelText = isSelected ? theme.fg("accent", styledId) : styledId;
      const providerBadge = theme.fg(
        "muted",
        item.model === undefined ? " [unavailable]" : ` [${item.model.provider}]`,
      );
      const status = item.model !== undefined && item.enabled ? theme.fg("accent", "✓ ") : "  ";
      self.listContainer.addChild(new Text(`${prefix}${status}${modelText}${providerBadge}`, 0, 0));
    }

    if (startIndex > 0 || endIndex < self.filteredItems.length) {
      self.listContainer.addChild(
        new Text(
          theme.fg("muted", `  (${self.selectedIndex + 1}/${self.filteredItems.length})`),
          0,
          0,
        ),
      );
    }

    const selected = self.filteredItems[self.selectedIndex];
    return selected;
  }

  constructor(
    config: scopedModelsSelectorTypes.ModelsConfig,
    callbacks: scopedModelsSelectorTypes.ModelsCallbacks,
  ) {
    super();
    this.callbacks = callbacks;

    for (const model of config.allModels) {
      const fullId = `${model.provider}/${model.id}`;
      this.modelsById.set(fullId, model);
      this.allIds.push(fullId);
    }

    this.enabledIds = config.enabledModelIds === null ? null : [...config.enabledModelIds];
    this.filteredItems = this.buildItems();

    this.addChild(new DynamicBorder());
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.fg("accent", theme.bold("Model Configuration")), 0, 0));
    this.addChild(
      new Text(
        theme.fg(
          "muted",
          `Session-only. ${keyDisplayText("app.models.save")} to save to settings.`,
        ),
        0,
        0,
      ),
    );
    this.addChild(new Spacer(1));

    this.searchInput = new Input();
    this.addChild(this.searchInput);
    this.addChild(new Spacer(1));

    this.listContainer = new Container();
    this.addChild(this.listContainer);

    this.addChild(new Spacer(1));
    if (config.refreshStatus !== undefined && config.refreshStatus !== "") {
      this.refreshStatusText = new Text(theme.fg("muted", `  ${config.refreshStatus}`), 0, 0);
      this.addChild(this.refreshStatusText);
    }
    this.footerText = new Text(this.getFooterText(), 0, 0);
    this.addChild(this.footerText);

    this.addChild(new DynamicBorder());
    this.updateList();
  }
}
