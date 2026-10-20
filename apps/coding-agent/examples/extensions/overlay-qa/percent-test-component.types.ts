import type PercentTestComponentClass from "./percent-test-component.ts";

declare namespace percentTestComponentTypes {
  type PercentTestComponent = (typeof PercentTestComponentClass)["prototype"];
}

export type { percentTestComponentTypes as default };
