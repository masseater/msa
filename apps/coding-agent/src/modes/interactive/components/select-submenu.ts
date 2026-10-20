import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import themeModule from "../theme/theme.ts";
import type settingsSubmenuTypes from "./settings-submenu.types.ts";

const { getSelectListTheme, theme } = themeModule;
const { Input, SelectList, Spacer, Text, fuzzyFilter, getKeybindings } = tui;

const SUBMENU_SELECT_LIST_LAYOUT: tuiTypes.SelectListLayoutOptions = {
  maxPrimaryColumnWidth: 32,
  minPrimaryColumnWidth: 12,
};
export default class SelectSubmenu extends tui.Container {
  private selectList: tuiTypes.SelectList;
  private listChildIndex: number;
  private allOptions: tuiTypes.SelectItem[];
  private listLayout: tuiTypes.SelectListLayoutOptions;
  private searchInput: tuiTypes.Input | undefined;
  private onSelectCb: (value: string) => void;
  private onCancelCb: () => void;
  private onSelectionChangeCb?: ((value: string) => void) | undefined;

  constructor(
    title: string,
    description: string,
    options: tuiTypes.SelectItem[],
    currentValue: string,
    onSelect: (value: string) => void,
    onCancel: () => void,
    onSelectionChange?: (value: string) => void,
    submenuOptions?: settingsSubmenuTypes.SelectSubmenuOptions,
  ) {
    super();

    this.allOptions = options;
    this.listLayout = submenuOptions?.layout ?? SUBMENU_SELECT_LIST_LAYOUT;
    this.onSelectCb = onSelect;
    this.onCancelCb = onCancel;
    this.onSelectionChangeCb = onSelectionChange;

    this.addChild(new Text(theme.bold(theme.fg("accent", title)), 0, 0));

    if (description !== "") {
      this.addChild(new Spacer(1));
      this.addChild(new Text(theme.fg("muted", description), 0, 0));
    }

    if (submenuOptions?.searchable === true) {
      this.addChild(new Spacer(1));
      this.searchInput = new Input();
      this.searchInput.onSubmit = () => {
        this.selectList.handleInput("\r");
      };
      this.addChild(this.searchInput);
    }

    this.addChild(new Spacer(1));

    this.selectList = this.buildSelectList(options, currentValue);
    this.listChildIndex = this.children.length;
    this.addChild(this.selectList);

    this.addChild(new Spacer(1));
    const hint =
      submenuOptions?.searchable === true
        ? "  Type to filter \u00b7 Enter to select \u00b7 Esc to go back"
        : "  Enter to select \u00b7 Esc to go back";
    this.addChild(new Text(theme.fg("dim", hint), 0, 0));
  }

  private buildSelectList(options: tuiTypes.SelectItem[], preselect: string): tuiTypes.SelectList {
    const list = new SelectList(
      options,
      Math.min(options.length, 10),
      getSelectListTheme(),
      this.listLayout,
    );

    const idx = options.findIndex((o) => o.value === preselect);
    if (idx !== -1) list.setSelectedIndex(idx);

    list.onSelect = (item) => this.onSelectCb(item.value);
    list.onCancel = this.onCancelCb;
    if (this.onSelectionChangeCb !== undefined) {
      const cb = this.onSelectionChangeCb;
      list.onSelectionChange = (item) => cb(item.value);
    }

    return list;
  }

  private applyFilter(query: string): void {
    const filtered =
      query === ""
        ? this.allOptions
        : fuzzyFilter(this.allOptions, query, (item) => `${item.label} ${item.description ?? ""}`);

    const newList = this.buildSelectList(filtered, "");
    this.children[this.listChildIndex] = newList;
    this.selectList = newList;
  }

  handleInput(data: string): void {
    if (this.searchInput === undefined) {
      this.selectList.handleInput(data);
    } else {
      const kb = getKeybindings();
      const isNav =
        kb.matches(data, "tui.select.up") ||
        kb.matches(data, "tui.select.down") ||
        kb.matches(data, "tui.select.confirm") ||
        kb.matches(data, "tui.select.cancel");
      if (isNav) {
        this.selectList.handleInput(data);
      } else {
        this.searchInput.handleInput(data);
        this.applyFilter(this.searchInput.getValue());
      }
    }
  }
}
