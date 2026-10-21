import type ToggleDemoComponentClass from "./toggle-demo-component.ts";

declare namespace toggleDemoComponentTypes {
  type ToggleDemoComponent = (typeof ToggleDemoComponentClass)["prototype"];
}

export type { toggleDemoComponentTypes as default };
