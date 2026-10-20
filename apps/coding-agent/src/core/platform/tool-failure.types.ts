import type ToolFailureClass from "./tool-failure.ts";

declare namespace toolFailureTypes {
  type ToolFailure = (typeof ToolFailureClass)["prototype"];
}

export type { toolFailureTypes as default };
