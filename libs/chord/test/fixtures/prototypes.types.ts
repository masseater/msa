import type { JsonValue } from "../../src/delta/index.ts";
import type prototypes from "./prototypes.ts";

declare namespace prototypesTypes {
  type JsonRecord = Record<string, JsonValue>;

  type TrapSetter = (typeof prototypes.TrapSetter)["prototype"];
}

export type { prototypesTypes as default };
