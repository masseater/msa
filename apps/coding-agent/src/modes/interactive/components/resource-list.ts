import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type settingsManagerTypes from "../../../core/settings-manager.types.ts";
import themeModule from "../theme/theme.ts";
import type configSelectorTypes from "./config-selector.types.ts";
import type resourceListInternalTypes from "./resource-list-internal.types.ts";
import ResourceListView from "./resource-list/resource-list-view.ts";
import ResourceOverrides from "./resource-list/resource-overrides.ts";
import ResourcePatterns from "./resource-list/resource-patterns.ts";
import ResourceToggling from "./resource-list/resource-toggling.ts";

const { theme } = themeModule;
const { truncateToWidth, getKeybindings, matchesKey, Input } = tui;

export default class ResourceList implements tuiTypes.Component, tuiTypes.Focusable {
  readonly patterns: ResourcePatterns;
  readonly overrides: ResourceOverrides;
  readonly toggling: ResourceToggling;
  readonly view: ResourceListView;

  private groupsByScope!: Record<
    configSelectorTypes.ConfigWriteScope,
    resourceListInternalTypes.ResourceGroup[]
  >;

  flatItems: resourceListInternalTypes.FlatEntry[] = [];

  filteredItems: resourceListInternalTypes.FlatEntry[] = [];

  selectedIndex = 0;

  private searchInput!: tuiTypes.Input;

  private maxVisible!: number;

  settingsManager!: settingsManagerTypes.SettingsManager;

  cwd!: string;

  agentDir!: string;

  writeScope!: configSelectorTypes.ConfigWriteScope;

  inheritedEnabledByKey!: Map<string, boolean>;

  onCancel?: () => void;

  onExit?: () => void;

  onToggle?: (item: resourceListInternalTypes.ResourceItem, newEnabled: boolean) => void;

  onSwitchMode?: () => void;

  private focusedState = false;

  get focused(): boolean {
    return this.focusedState;
  }

  set focused(value: boolean) {
    this.focusedState = value;
    this.searchInput.focused = value;
  }

  setWriteScope(writeScope: configSelectorTypes.ConfigWriteScope): void {
    this.writeScope = writeScope;
    this.view.buildFlatList();
    this.view.filterItems(this.searchInput.getValue());
  }

  get groups(): resourceListInternalTypes.ResourceGroup[] {
    return this.groupsByScope[this.writeScope];
  }

  updateItem(item: resourceListInternalTypes.ResourceItem, enabled: boolean): void {
    item.enabled = enabled;
    for (const group of this.groups) {
      for (const subgroup of group.subgroups) {
        const found = subgroup.items.find(
          (i) => i.path === item.path && i.resourceType === item.resourceType,
        );
        if (found !== undefined) {
          found.enabled = enabled;
          return;
        }
      }
    }
  }

  invalidate(): void {}

  render(width: number): string[] {
    const lines: string[] = [];

    lines.push(...this.searchInput.render(width));
    lines.push("");

    if (this.filteredItems.length === 0) {
      lines.push(theme.fg("muted", "  No resources found"));
      return lines;
    }

    const startIndex = Math.max(
      0,
      Math.min(
        this.selectedIndex - Math.floor(this.maxVisible / 2),
        this.filteredItems.length - this.maxVisible,
      ),
    );
    const endIndex = Math.min(startIndex + this.maxVisible, this.filteredItems.length);

    for (const [offset, entry] of this.filteredItems.slice(startIndex, endIndex).entries()) {
      const isSelected = startIndex + offset === this.selectedIndex;

      if (entry.type === "group") {
        const inherited = this.writeScope === "project" && entry.group.scope === "user";
        const label = theme.bold(`${entry.group.label}${inherited ? " · inherited global" : ""}`);
        const groupLine = theme.fg(inherited ? "dim" : "accent", label);
        lines.push(truncateToWidth(`  ${groupLine}`, width, ""));
      } else if (entry.type === "subgroup") {
        const color =
          this.writeScope === "project" && entry.group.scope === "user" ? "dim" : "muted";
        const subgroupLine = theme.fg(color, entry.subgroup.label);
        lines.push(truncateToWidth(`    ${subgroupLine}`, width, ""));
      } else {
        this.view.renderItem(entry, isSelected, lines, width);
      }
    }

    if (startIndex > 0 || endIndex < this.filteredItems.length) {
      const itemCount = this.filteredItems.filter((e) => e.type === "item").length;
      const currentItemIndex =
        this.filteredItems.slice(0, this.selectedIndex).filter((e) => e.type === "item").length + 1;
      lines.push(theme.fg("dim", `  (${currentItemIndex}/${itemCount})`));
    }

    return lines;
  }

  handleInput(data: string): void {
    const kb = getKeybindings();

    if (kb.matches(data, "tui.select.up")) {
      this.selectedIndex = this.view.findNextItem(this.selectedIndex, -1);
      return;
    }
    if (kb.matches(data, "tui.select.down")) {
      this.selectedIndex = this.view.findNextItem(this.selectedIndex, 1);
      return;
    }
    if (kb.matches(data, "tui.select.pageUp")) {
      let target = Math.max(0, this.selectedIndex - this.maxVisible);
      while (target < this.filteredItems.length && this.filteredItems[target]?.type !== "item") {
        target++;
      }
      if (target < this.filteredItems.length) {
        this.selectedIndex = target;
      }
      return;
    }
    if (kb.matches(data, "tui.select.pageDown")) {
      let target = Math.min(this.filteredItems.length - 1, this.selectedIndex + this.maxVisible);
      while (target >= 0 && this.filteredItems[target]?.type !== "item") {
        target--;
      }
      if (target >= 0) {
        this.selectedIndex = target;
      }
      return;
    }
    if (kb.matches(data, "tui.select.cancel")) {
      this.onCancel?.();
      return;
    }
    if (matchesKey(data, "ctrl+c")) {
      this.onExit?.();
      return;
    }
    if (kb.matches(data, "tui.input.tab")) {
      this.onSwitchMode?.();
      return;
    }
    if (data === " " || kb.matches(data, "tui.select.confirm")) {
      return this.toggling.toggleSelected();
    }

    this.searchInput.handleInput(data);
    this.view.filterItems(this.searchInput.getValue());
  }

  constructor(
    groupsByScope: Record<
      configSelectorTypes.ConfigWriteScope,
      resourceListInternalTypes.ResourceGroup[]
    >,
    settingsManager: settingsManagerTypes.SettingsManager,
    cwd: string,
    agentDir: string,
    terminalHeight?: number,
    writeScope: configSelectorTypes.ConfigWriteScope = "global",
  ) {
    this.patterns = new ResourcePatterns(this);
    this.overrides = new ResourceOverrides(this);
    this.toggling = new ResourceToggling(this);
    this.view = new ResourceListView(this);
    this.groupsByScope = groupsByScope;
    this.settingsManager = settingsManager;
    this.cwd = cwd;
    this.agentDir = agentDir;
    this.writeScope = writeScope;
    this.inheritedEnabledByKey = this.overrides.buildInheritedEnabledMap(groupsByScope.global);
    this.searchInput = new Input();
    const chrome = 8;
    this.maxVisible = Math.max(5, (terminalHeight ?? 24) - chrome);
    this.view.buildFlatList();
    this.filteredItems = [...this.flatItems];
  }
}
