import type deltaTypes from "../../src/delta/index.types.ts";
import type TrapSetterClass from "./trap-setter.ts";

declare namespace prototypesTypes {
  type JsonRecord = Record<string, deltaTypes.JsonValue>;

  type TrapSetter = (typeof TrapSetterClass)["prototype"];
}

export type { prototypesTypes as default };
