import type AnimationDemoComponentClass from "./animation-demo-component.ts";

declare namespace animationDemoComponentTypes {
  type AnimationDemoComponent = (typeof AnimationDemoComponentClass)["prototype"];
}

export type { animationDemoComponentTypes as default };
