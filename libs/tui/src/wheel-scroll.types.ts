import type WheelScrollAcceleratorClass from "./wheel-scroll.ts";

declare namespace wheelScrollTypes {
  type WheelScrollLines = number | "auto";

  type WheelScrollAccelerator = WheelScrollAcceleratorClass;
}

export type { wheelScrollTypes as default };
