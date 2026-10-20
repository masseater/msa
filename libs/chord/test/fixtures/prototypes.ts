import type { JsonValue } from "../../src/delta/index.ts";
import type prototypesTypes from "./prototypes.types.ts";

const throwingSetter = (message: string): PropertyDescriptor => ({
  configurable: true,
  get() {
    return undefined;
  },
  set() {
    throw new Error(message);
  },
});

const trappedObject = (): prototypesTypes.JsonRecord =>
  Object.create(
    Object.create(Object.prototype, { trap: throwingSetter("inherited setter ran") }),
  ) as prototypesTypes.JsonRecord;

const trappedArray = (values: readonly JsonValue[]): JsonValue[] =>
  Object.setPrototypeOf(
    [...values],
    Object.create(Array.prototype, { 0: throwingSetter("inherited array setter ran") }),
  ) as JsonValue[];

class TrapSetter {
  [key: string]: JsonValue;

  get trap(): JsonValue {
    return null;
  }

  set trap(_value: JsonValue) {
    throw new Error("inherited setter ran");
  }
}

const prototypes = {
  TrapSetter,
  trappedArray,
  trappedObject,
};

export default prototypes;
