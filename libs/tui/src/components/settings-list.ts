import fuzzy from "../fuzzy.ts";
import keybindingsModule from "../keybindings.ts";
import textTruncate from "../text-truncate.ts";
import type tuiComponentTypes from "../tui-component.types.ts";
import Input from "./input.ts";
import type inputTypes from "./input.types.ts";
import settingsListItems from "./settings-list-items.ts";
import type settingsListItemsTypes from "./settings-list-items.types.ts";

const { truncateToWidth } = textTruncate;
const { descriptionLines, settingItemLine, settingsHint, visibleItemRange } = settingsListItems;
const { getKeybindings } = keybindingsModule;
const { fuzzyFilter } = fuzzy;

export default class SettingsList implements tuiComponentTypes.Component {
  private items: settingsListItemsTypes.SettingItem[];
  private filteredItems: settingsListItemsTypes.SettingItem[];
  private theme: settingsListItemsTypes.SettingsListTheme;
  private selectedIndex = 0;
  private mousePressedIndex: number | undefined;
  private maxVisible: number;
  private onChange: (id: string, newValue: string) => void;
  private onCancel: () => void;
  private searchInput?: inputTypes.Input;
  private searchEnabled: boolean;

  private submenuComponent: tuiComponentTypes.Component | null = null;
  private submenuItemIndex: number | null = null;
  private navigateAfterClose: string | null = null;

  constructor(
    items: settingsListItemsTypes.SettingItem[],
    maxVisible: number,
    theme: settingsListItemsTypes.SettingsListTheme,
    onChange: (id: string, newValue: string) => void,
    onCancel: () => void,
    options: settingsListItemsTypes.SettingsListOptions = {},
  ) {
    this.items = items;
    this.filteredItems = items;
    this.maxVisible = maxVisible;
    this.theme = theme;
    this.onChange = onChange;
    this.onCancel = onCancel;
    this.searchEnabled = options.enableSearch ?? false;
    if (this.searchEnabled) {
      this.searchInput = new Input();
    }
  }

  updateValue(id: string, newValue: string): void {
    const item = this.items.find((i) => i.id === id);
    if (item !== undefined) {
      item.currentValue = newValue;
    }
  }

  selectItem(id: string): void {
    const items = this.searchEnabled ? this.filteredItems : this.items;
    const index = items.findIndex((i) => i.id === id);
    if (index !== -1) {
      this.selectedIndex = index;
    }
  }

  invalidate(): void {
    this.submenuComponent?.invalidate?.();
  }

  render(width: number): string[] {
    if (this.submenuComponent !== null) {
      return this.submenuComponent.render(width);
    }

    return this.renderMainList(width);
  }

  private renderMainList(width: number): string[] {
    const lines: string[] = [];

    if (this.searchEnabled && this.searchInput !== undefined) {
      lines.push(...this.searchInput.render(width));
      lines.push("");
    }

    if (this.items.length === 0) {
      lines.push(this.theme.hint("  No settings available"));
      if (this.searchEnabled) this.addHintLine(lines, width);
      return lines;
    }

    const displayItems = this.getDisplayItems();
    if (displayItems.length === 0) {
      lines.push(truncateToWidth(this.theme.hint("  No matching settings"), width));
      this.addHintLine(lines, width);
      return lines;
    }

    const { startIndex, endIndex } = visibleItemRange({
      itemCount: displayItems.length,
      maxVisible: this.maxVisible,
      selectedIndex: this.selectedIndex,
    });

    for (let i = startIndex; i < endIndex; i++) {
      const item = displayItems[i];
      if (item === undefined) continue;
      const line = { isSelected: i === this.selectedIndex, item };
      lines.push(settingItemLine(this.theme, this.items, line, width));
    }

    if (startIndex > 0 || endIndex < displayItems.length) {
      const scrollText = `  (${this.selectedIndex + 1}/${displayItems.length})`;
      lines.push(this.theme.hint(truncateToWidth(scrollText, width - 2, "")));
    }

    lines.push(...descriptionLines(this.theme, displayItems[this.selectedIndex], width));
    this.addHintLine(lines, width);

    return lines;
  }

  handleMouse(
    event: tuiComponentTypes.TuiMouseEvent,
  ): tuiComponentTypes.TuiMouseEventResult | undefined {
    if (this.submenuComponent !== null) {
      const result = this.submenuComponent.handleMouse?.(event);
      return result === undefined ? undefined : { ...result, focus: true };
    }

    if (this.searchEnabled && this.searchInput !== undefined) {
      if (event.y === 0) {
        const result = this.searchInput.handleMouse?.(event);
        return result === undefined ? undefined : { ...result, focus: true };
      }
      if (event.y === 1) return undefined;
    }

    return this.#handleListMouse(event);
  }

  #handleListMouse(
    event: tuiComponentTypes.TuiMouseEvent,
  ): tuiComponentTypes.TuiMouseEventResult | undefined {
    const displayItems = this.getDisplayItems();
    if (displayItems.length === 0) return undefined;
    if (event.type === "wheel" && event.wheelDelta !== undefined && event.wheelDelta !== 0) {
      const delta = event.wheelDelta < 0 ? -1 : 1;
      const previousIndex = this.selectedIndex;
      this.selectedIndex = Math.max(
        0,
        Math.min(displayItems.length - 1, this.selectedIndex + delta),
      );
      return { handled: true, render: this.selectedIndex !== previousIndex };
    }
    if (event.button !== "left" || (event.type !== "press" && event.type !== "click"))
      return undefined;

    const rowOffset = this.searchEnabled ? 2 : 0;
    const { startIndex, endIndex } = visibleItemRange({
      itemCount: displayItems.length,
      maxVisible: this.maxVisible,
      selectedIndex: this.selectedIndex,
    });
    const itemIndex = startIndex + event.y - rowOffset;
    if (itemIndex < startIndex || itemIndex >= endIndex) return undefined;
    if (event.type === "press") {
      this.mousePressedIndex = itemIndex;
      this.selectedIndex = itemIndex;
      return { focus: true, handled: true };
    }
    if (event.type === "click") {
      this.selectedIndex = this.mousePressedIndex ?? itemIndex;
      this.mousePressedIndex = undefined;
      this.activateItem();
      return { handled: true };
    }
    return undefined;
  }

  handleInput(data: string): void {
    if (this.submenuComponent !== null) {
      this.submenuComponent.handleInput?.(data);
      return;
    }

    const kb = getKeybindings();
    const displayItems = this.getDisplayItems();
    if (kb.matches(data, "tui.select.up")) {
      if (displayItems.length === 0) return;
      this.selectedIndex =
        this.selectedIndex === 0 ? displayItems.length - 1 : this.selectedIndex - 1;
    } else if (kb.matches(data, "tui.select.down")) {
      if (displayItems.length === 0) return;
      this.selectedIndex =
        this.selectedIndex === displayItems.length - 1 ? 0 : this.selectedIndex + 1;
    } else if (
      kb.matches(data, "tui.select.confirm") ||
      (data === " " && (!this.searchEnabled || this.searchInput?.getValue().length === 0))
    ) {
      this.activateItem();
    } else if (kb.matches(data, "tui.select.cancel")) {
      this.onCancel();
    } else if (this.searchEnabled && this.searchInput !== undefined) {
      this.searchInput.handleInput(data);
      this.applyFilter(this.searchInput.getValue());
    }
  }

  private getDisplayItems(): settingsListItemsTypes.SettingItem[] {
    return this.searchEnabled ? this.filteredItems : this.items;
  }

  private activateItem(): void {
    const item = this.getDisplayItems()[this.selectedIndex];
    if (item === undefined) return;

    if (item.submenu !== undefined) {
      this.submenuItemIndex = this.selectedIndex;
      this.submenuComponent = item.submenu(
        item.currentValue,
        (selectedValue?: string, options?: { navigateTo?: string }) => {
          if (selectedValue !== undefined) {
            item.currentValue = selectedValue;
            this.onChange(item.id, selectedValue);
          }
          if (options?.navigateTo !== undefined && options?.navigateTo !== "") {
            this.navigateAfterClose = options.navigateTo;
          }
          this.closeSubmenu();
        },
      );
    } else if (item.values !== undefined && item.values.length > 0) {
      const currentIndex = item.values.indexOf(item.currentValue);
      const nextIndex = (currentIndex + 1) % item.values.length;
      const newValue = item.values[nextIndex];
      if (newValue === undefined) {
        throw new Error(`Setting ${item.id} has no value at ${nextIndex}`);
      }
      item.currentValue = newValue;
      this.onChange(item.id, newValue);
    }
  }

  private closeSubmenu(): void {
    this.submenuComponent = null;
    if (this.navigateAfterClose !== null) {
      const id = this.navigateAfterClose;
      this.navigateAfterClose = null;
      this.submenuItemIndex = null;
      this.selectItem(id);
      this.activateItem();
    } else if (this.submenuItemIndex !== null) {
      this.selectedIndex = this.submenuItemIndex;
      this.submenuItemIndex = null;
    }
  }

  private applyFilter(query: string): void {
    this.filteredItems = fuzzyFilter(this.items, query, (item) => item.label);
    this.selectedIndex = 0;
  }

  private addHintLine(lines: string[], width: number): void {
    lines.push("");
    lines.push(truncateToWidth(this.theme.hint(settingsHint(this.searchEnabled)), width));
  }
}
