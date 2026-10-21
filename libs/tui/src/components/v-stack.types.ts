import type stackTypes from "./stack.types.ts";
import type VStackClass from "./v-stack.ts";

declare namespace vStackTypes {
  type StackChild = stackTypes.StackChild;

  type StackEntry = stackTypes.StackEntry;

  type StackEntryOptions = stackTypes.StackEntryOptions;

  type StackOptions = stackTypes.StackOptions;

  type VStack = VStackClass;
}

export type { vStackTypes as default };
