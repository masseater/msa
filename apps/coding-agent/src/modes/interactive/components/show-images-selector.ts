import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import themeModule from "../theme/theme.ts";
import DynamicBorder from "./dynamic-border.ts";
const { getSelectListTheme } = themeModule;

const { SelectList } = tui;

const SHOW_IMAGES_SELECT_LIST_LAYOUT: tuiTypes.SelectListLayoutOptions = {
  maxPrimaryColumnWidth: 32,
  minPrimaryColumnWidth: 12,
};

export default class ShowImagesSelectorComponent extends tui.Container {
  private selectList: tuiTypes.SelectList;

  constructor(currentValue: boolean, onSelect: (show: boolean) => void, onCancel: () => void) {
    super();

    const items: tuiTypes.SelectItem[] = [
      { description: "Show images inline in terminal", label: "Yes", value: "yes" },
      { description: "Show text placeholder instead", label: "No", value: "no" },
    ];

    this.addChild(new DynamicBorder());

    this.selectList = new SelectList(
      items,
      5,
      getSelectListTheme(),
      SHOW_IMAGES_SELECT_LIST_LAYOUT,
    );

    this.selectList.setSelectedIndex(currentValue ? 0 : 1);

    this.selectList.onSelect = (item) => {
      onSelect(item.value === "yes");
    };

    this.selectList.onCancel = () => {
      onCancel();
    };

    this.addChild(this.selectList);

    this.addChild(new DynamicBorder());
  }

  getSelectList(): tuiTypes.SelectList {
    return this.selectList;
  }
}
