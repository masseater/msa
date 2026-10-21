import type ExpandableTextClass from "./expandable-text.ts";

declare namespace expandableTextTypes {
  interface Expandable {
    setExpanded(expanded: boolean): void;
  }

  type ExpandableText = (typeof ExpandableTextClass)["prototype"];
}

export type { expandableTextTypes as default };
