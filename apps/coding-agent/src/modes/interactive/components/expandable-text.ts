import type tuiTypes from "@msa/tui/index.types";

import type expandableTextTypes from "./expandable-text.types.ts";
import ThemedText from "./themed-text.ts";

export default class ExpandableText implements tuiTypes.Component, expandableTextTypes.Expandable {
  private expanded: boolean;
  private readonly text: ThemedText;

  constructor(
    getCollapsedText: () => string,
    getExpandedText: () => string,
    expanded = false,
    paddingX = 0,
    paddingY = 0,
  ) {
    this.expanded = expanded;
    this.text = new ThemedText(
      () => (this.expanded ? getExpandedText() : getCollapsedText()),
      paddingX,
      paddingY,
    );
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.text.invalidate();
  }

  render(width: number): string[] {
    return this.text.render(width);
  }

  invalidate(): void {
    this.text.invalidate();
  }
}
