import type ToolGroupComponentClass from "./tool-group.ts";

declare namespace toolGroupTypes {
  type ToolGroupComponent = (typeof ToolGroupComponentClass)["prototype"];
}

export type { toolGroupTypes as default };
