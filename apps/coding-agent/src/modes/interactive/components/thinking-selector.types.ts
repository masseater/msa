import type ThinkingSelectorComponentClass from "./thinking-selector.ts";

declare namespace thinkingSelectorTypes {
  type ThinkingSelectorComponent = (typeof ThinkingSelectorComponentClass)["prototype"];
}

export type { thinkingSelectorTypes as default };
