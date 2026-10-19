import { ThemedText } from "./themed-text.ts";

export interface Expandable {
  setExpanded(expanded: boolean): void;
}

export function isExpandable(obj: unknown): obj is Expandable {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "setExpanded" in obj &&
    typeof obj.setExpanded === "function"
  );
}

export class ExpandableText extends ThemedText implements Expandable {
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
