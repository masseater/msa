import type deltaTypes from "../../src/delta/index.types.ts";

export default class TrapSetter {
  [key: string]: deltaTypes.JsonValue;

  get trap(): deltaTypes.JsonValue {
    return null;
  }

  set trap(_value: deltaTypes.JsonValue) {
    throw new Error("inherited setter ran");
  }
}
