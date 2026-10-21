import type DynamicBorderClass from "./dynamic-border.ts";

declare namespace dynamicBorderTypes {
  type DynamicBorder = (typeof DynamicBorderClass)["prototype"];
}

export type { dynamicBorderTypes as default };
