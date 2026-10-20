import type expandableTextTypes from "./expandable-text.types.ts";
import ThemedText from "./themed-text.ts";

export default class ExpandableText extends ThemedText implements expandableTextTypes.Expandable {
  private readonly state: { expanded: boolean };

  constructor(
    getCollapsedText: () => string,
    getExpandedText: () => string,
    expanded = false,
    paddingX = 0,
    paddingY = 0,
  ) {
    const state = { expanded };
    super(() => (state.expanded ? getExpandedText() : getCollapsedText()), paddingX, paddingY);
    this.state = state;
  }

  setExpanded(expanded: boolean): void {
    this.state.expanded = expanded;
    this.invalidate();
  }
}
