import type BoxClass from "./box.ts";

declare namespace boxTypes {
  type Box = BoxClass;
}

export type { boxTypes as default };
