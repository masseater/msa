import type layoutNodeTypes from "../layout-node.types.ts";
import type tuiComponentTypes from "../tui-component.types.ts";
import type stack from "./stack.ts";

declare namespace stackTypes {
  interface StackEntryOptions {
    basis?: number | "auto";
    grow?: number;
    shrink?: number;
    minSize?: number;
    maxSize?: number;
    visible?: (viewport: layoutNodeTypes.LayoutViewport) => boolean;
  }

  interface StackEntry extends StackEntryOptions {
    component: tuiComponentTypes.Component;
  }

  type StackChild = tuiComponentTypes.Component | StackEntry;

  interface StackOptions {
    gap?: number;
    align?: "stretch" | "start" | "center" | "end";
  }

  type Stack = (typeof stack.Stack)["prototype"];
}

export type { stackTypes as default };
