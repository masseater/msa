import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import themeModule from "../theme/theme.ts";
import DynamicBorder from "./dynamic-border.ts";

const { getAvailableThemes, getSelectListTheme } = themeModule;
const { SelectList } = tui;

const THEME_SELECT_LIST_LAYOUT: tuiTypes.SelectListLayoutOptions = {
  maxPrimaryColumnWidth: 32,
  minPrimaryColumnWidth: 12,
};

export default class ThemeSelectorComponent extends tui.Container {
  private selectList: tuiTypes.SelectList;
  private onPreview: (themeName: string) => void;

  constructor(
    currentTheme: string,
    onSelect: (themeName: string) => void,
    onCancel: () => void,
    onPreview: (themeName: string) => void,
  ) {
    super();
    this.onPreview = onPreview;

    const themes = getAvailableThemes();
    const themeItems: tuiTypes.SelectItem[] = themes.map((name) => ({
      label: name,
      value: name,
      ...(name === currentTheme ? { description: "(current)" } : {}),
    }));

    this.addChild(new DynamicBorder());

    this.selectList = new SelectList(
      themeItems,
      10,
      getSelectListTheme(),
      THEME_SELECT_LIST_LAYOUT,
    );

    const currentIndex = themes.indexOf(currentTheme);
    if (currentIndex !== -1) {
      this.selectList.setSelectedIndex(currentIndex);
    }

    this.selectList.onSelect = (item) => {
      onSelect(item.value);
    };

    this.selectList.onCancel = () => {
      onCancel();
    };

    this.selectList.onSelectionChange = (item) => {
      this.onPreview(item.value);
    };

    this.addChild(this.selectList);

    this.addChild(new DynamicBorder());
  }

  getSelectList(): tuiTypes.SelectList {
    return this.selectList;
  }
}
