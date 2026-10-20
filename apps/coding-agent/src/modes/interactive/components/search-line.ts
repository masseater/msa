import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import themeModule from "../theme/theme.ts";
import TreeList from "./tree-list.ts";
const { theme } = themeModule;
const { truncateToWidth } = tui;

export default class SearchLine implements tuiTypes.Component {
  private treeList: TreeList;

  constructor(treeList: TreeList) {
    this.treeList = treeList;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const query = this.treeList.getSearchQuery();
    if (query !== "") {
      return [
        truncateToWidth(
          `  ${theme.fg("muted", "Type to search:")} ${theme.fg("accent", query)}`,
          width,
        ),
      ];
    }
    return [truncateToWidth(`  ${theme.fg("muted", "Type to search:")}`, width)];
  }

  handleInput(_keyData: string): void {}
}
