import type { JsonValue } from "../../src/delta/index.ts";

export type JsonRecord = Record<string, JsonValue>;

const throwingSetter = (message: string): PropertyDescriptor => ({
  get() {
    return undefined;
  },
  set() {
    throw new Error(message);
  },
  configurable: true,
});

export const trappedObject = (): JsonRecord =>
  Object.create(
    Object.create(Object.prototype, { trap: throwingSetter("inherited setter ran") }),
  ) as JsonRecord;

export const trappedArray = (values: readonly JsonValue[]): JsonValue[] =>
  Object.setPrototypeOf(
    [...values],
    Object.create(Array.prototype, { 0: throwingSetter("inherited array setter ran") }),
  ) as JsonValue[];

export class TrapSetter {
  [key: string]: JsonValue;

  get trap(): JsonValue {
    return null;
  }

  set trap(_value: JsonValue) {
    throw new Error("inherited setter ran");
  }
}
