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

const prototypes = {
  trappedArray,
  trappedObject,
};

export default prototypes;
