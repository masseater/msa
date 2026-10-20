import type deltaTypes from "../../src/delta/index.types.ts";
import type prototypes from "./prototypes.ts";

declare namespace prototypesTypes {
  type JsonRecord = Record<string, deltaTypes.JsonValue>;

  type TrapSetter = (typeof prototypes.TrapSetter)["prototype"];
}

export type { prototypesTypes as default };
