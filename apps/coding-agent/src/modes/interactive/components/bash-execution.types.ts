import type BashExecutionComponentClass from "./bash-execution.ts";

declare namespace bashExecutionTypes {
  type BashExecutionComponent = (typeof BashExecutionComponentClass)["prototype"];
}

export type { bashExecutionTypes as default };
