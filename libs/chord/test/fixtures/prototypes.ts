import type deltaTypes from "../../src/delta/index.types.ts";
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

const trappedArray = (values: readonly deltaTypes.JsonValue[]): deltaTypes.JsonValue[] =>
  Object.setPrototypeOf(
    [...values],
    Object.create(Array.prototype, { 0: throwingSetter("inherited array setter ran") }),
  ) as deltaTypes.JsonValue[];

class TrapSetter {
  [key: string]: deltaTypes.JsonValue;

  get trap(): deltaTypes.JsonValue {
    return null;
  }

  set trap(_value: deltaTypes.JsonValue) {
    throw new Error("inherited setter ran");
  }
}

const prototypes = {
  TrapSetter,
  trappedArray,
  trappedObject,
};

export default prototypes;
