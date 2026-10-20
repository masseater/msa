import type agentTypes from "@msa/agent-core/index.types";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import { getSelectListTheme, theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyDisplayText } from "./keybinding-hints.ts";

const { Container, Input, SelectList, Spacer, Text, fuzzyFilter, getKeybindings } = tui;

const THINKING_SELECT_LIST_LAYOUT: tuiTypes.SelectListLayoutOptions = {
  maxPrimaryColumnWidth: 32,
  minPrimaryColumnWidth: 12,
};

const LEVEL_DESCRIPTIONS: Record<agentTypes.ThinkingLevel, string> = {
  high: "Deep reasoning (~16k tokens)",
  low: "Light reasoning (~2k tokens)",
  max: "Maximum reasoning",
  medium: "Moderate reasoning (~8k tokens)",
  minimal: "Very brief reasoning (~1k tokens)",
  off: "No reasoning",
  xhigh: "Extra-high reasoning (~32k tokens)",
};

export class ThinkingSelectorComponent extends Container implements tuiTypes.Focusable {
  private searchInput: tuiTypes.Input;
  private selectList: tuiTypes.SelectList;
  private selectListChildIndex: number;
  private allItems: tuiTypes.SelectItem[];
  private onSelect: (level: agentTypes.ThinkingLevel) => void;
  private onCancel: () => void;
  private onSelectAsDefault?: ((level: agentTypes.ThinkingLevel) => void) | undefined;
  private focusedState = false;

  get focused(): boolean {
    return this.focusedState;
  }

  set focused(value: boolean) {
    this.focusedState = value;
    this.searchInput.focused = value;
  }

  constructor(
    currentLevel: agentTypes.ThinkingLevel,
    availableLevels: agentTypes.ThinkingLevel[],
    onSelect: (level: agentTypes.ThinkingLevel) => void,
    onCancel: () => void,
    onSelectAsDefault?: (level: agentTypes.ThinkingLevel) => void,
    defaultThinkingLevel?: agentTypes.ThinkingLevel,
  ) {
    super();
    this.onSelect = onSelect;
    this.onCancel = onCancel;
    this.onSelectAsDefault = onSelectAsDefault;

    this.allItems = availableLevels.map((level) => ({
      description:
        level === defaultThinkingLevel
          ? `${LEVEL_DESCRIPTIONS[level]} · default`
          : LEVEL_DESCRIPTIONS[level],
      label: `${level === currentLevel ? "✓ " : "  "}${level}`,
      value: level,
    }));

    this.addChild(new DynamicBorder());
    this.addChild(new Spacer(1));
    this.addChild(new Text("Thinking Level", 0, 0));
    this.addChild(new Spacer(1));
    this.addChild(
      new Text(`${keyDisplayText("app.thinking.cycle")} cycles thinking levels in-session`, 0, 0),
    );
    this.addChild(new Spacer(1));

    this.searchInput = new Input();
    this.searchInput.onSubmit = () => this.selectList.handleInput("\r");
    this.addChild(this.searchInput);
    this.addChild(new Spacer(1));

    this.selectList = this.buildSelectList(this.allItems, currentLevel);
    this.selectListChildIndex = this.children.length;
    ThinkingSelectorComponent.buildPart1(this);

    this.addChild(new DynamicBorder());
  }

  private static buildPart1(self: ThinkingSelectorComponent): void {
    self.addChild(self.selectList);
    self.addChild(new Spacer(1));
    self.addChild(
      new Text(
        theme.fg(
          "dim",
          `  ${keyDisplayText("tui.select.confirm")} to select · ${keyDisplayText("app.thinking.save")} to set as default · ${keyDisplayText("tui.select.cancel")} to cancel`,
        ),
        0,
        0,
      ),
    );
  }

  private buildSelectList(
    items: tuiTypes.SelectItem[],
    preselect?: agentTypes.ThinkingLevel,
  ): tuiTypes.SelectList {
    const list = new SelectList(
      items,
      Math.max(1, items.length),
      getSelectListTheme(),
      THINKING_SELECT_LIST_LAYOUT,
    );
    const currentIndex = items.findIndex((item) => item.value === preselect);
    if (currentIndex !== -1) {
      list.setSelectedIndex(currentIndex);
    }
    list.onSelect = (item) => this.onSelect(item.value as agentTypes.ThinkingLevel);
    list.onCancel = () => this.onCancel();
    return list;
  }

  private applyFilter(query: string): void {
    const filtered =
      query === ""
        ? this.allItems
        : fuzzyFilter(this.allItems, query, (item) => `${item.value} ${item.description ?? ""}`);
    const selectedValue = this.selectList.getSelectedItem()?.value as
      | agentTypes.ThinkingLevel
      | undefined;
    const newList = this.buildSelectList(filtered, selectedValue);
    this.children[this.selectListChildIndex] = newList;
    this.selectList = newList;
  }

  handleInput(keyData: string): void {
    const kb = getKeybindings();
    if (kb.matches(keyData, "app.thinking.save") && this.onSelectAsDefault !== undefined) {
      const item = this.selectList.getSelectedItem();
      if (item !== null) this.onSelectAsDefault(item.value as agentTypes.ThinkingLevel);
      return;
    }

    const isNav =
      kb.matches(keyData, "tui.select.up") ||
      kb.matches(keyData, "tui.select.down") ||
      kb.matches(keyData, "tui.select.confirm") ||
      kb.matches(keyData, "tui.select.cancel");
    if (isNav) {
      this.selectList.handleInput(keyData);
      return;
    }

    this.searchInput.handleInput(keyData);
    this.applyFilter(this.searchInput.getValue());
  }

  getSelectList(): tuiTypes.SelectList {
    return this.selectList;
  }
}
