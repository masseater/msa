import type AnchorTestComponentClass from "./anchor-test-component.ts";

declare namespace anchorTestComponentTypes {
  type AnchorTestComponent = (typeof AnchorTestComponentClass)["prototype"];
}

export type { anchorTestComponentTypes as default };
