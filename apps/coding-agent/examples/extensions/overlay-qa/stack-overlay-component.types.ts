import type StackOverlayComponentClass from "./stack-overlay-component.ts";

declare namespace stackOverlayComponentTypes {
  type StackOverlayComponent = (typeof StackOverlayComponentClass)["prototype"];
}

export type { stackOverlayComponentTypes as default };
