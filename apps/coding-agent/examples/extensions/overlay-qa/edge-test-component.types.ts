import type EdgeTestComponentClass from "./edge-test-component.ts";

declare namespace edgeTestComponentTypes {
  type EdgeTestComponent = (typeof EdgeTestComponentClass)["prototype"];
}

export type { edgeTestComponentTypes as default };
