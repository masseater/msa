import tui from "@msa/tui";

import themeModule from "../theme/theme.ts";
import DynamicBorder from "./dynamic-border.ts";
import SearchLine from "./search-line.ts";
import TreeHelp from "./tree-help.ts";
import type TreeList from "./tree-list.ts";

const { theme } = themeModule;
const { Spacer, Text } = tui;

export default class TreeSelectorHeader extends tui.Container {
  constructor(treeList: TreeList) {
    super();
    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder());
    this.addChild(new Text(theme.bold("  Session Tree"), 1, 0));
    this.addChild(new TreeHelp());
    this.addChild(new SearchLine(treeList));
    this.addChild(new DynamicBorder());
    this.addChild(new Spacer(1));
  }
}
