import type MarginTestComponentClass from "./margin-test-component.ts";

declare namespace marginTestComponentTypes {
  type MarginTestComponent = (typeof MarginTestComponentClass)["prototype"];
}

export type { marginTestComponentTypes as default };
