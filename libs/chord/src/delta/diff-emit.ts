import { dual } from "effect/Function";

import type jsonTypes from "../json.types.ts";
import type opsTypes from "./ops.types.ts";
import overlapModule from "./overlap.ts";

const { overlap } = overlapModule;

const DEFAULT_OVERLAP_SCAN = 65_536;
const MAX_DELTA_OPERATIONS = 4_096;
const overflowedBatches = new WeakSet<opsTypes.Op[]>();

const operationEmitted = (operations: opsTypes.Op[], operation: opsTypes.Op): void => {
  if (overflowedBatches.has(operations)) return;
  if (operations.length >= MAX_DELTA_OPERATIONS) {
    overflowedBatches.add(operations);
    return;
  }
  operations.push(operation);
};

const isContainer = (
  value: jsonTypes.JsonValue,
): value is jsonTypes.JsonValue[] | Record<string, jsonTypes.JsonValue> =>
  value !== null && typeof value === "object";

const setEmitted = (
  path: opsTypes.Path,
  value: jsonTypes.JsonValue,
  operations: opsTypes.Op[],
): void => {
  if (path.length === 0) emitOperation(operations, ["r", value]);
  else emitOperation(operations, ["s", path as opsTypes.NonEmptyPath, value]);
};

const jsonEqual = (left: jsonTypes.JsonValue, right: jsonTypes.JsonValue): boolean => {
  if (left === right) return true;
  if (!isContainer(left) || !isContainer(right) || Array.isArray(left) !== Array.isArray(right))
    return false;
  if (Array.isArray(left)) {
    const other = right as jsonTypes.JsonValue[];
    if (left.length !== other.length) return false;
    for (let index = 0; index < left.length; index++) {
      if (!equalJson(left[index]!, other[index]!)) return false;
    }
    return true;
  }
  const other = right as Record<string, jsonTypes.JsonValue>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(other).length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(other, key) || !equalJson(left[key]!, other[key]!)) return false;
  }
  return true;
};

const permutationOf = (
  before: readonly jsonTypes.JsonValue[],
  after: readonly jsonTypes.JsonValue[],
): number[] | undefined => {
  if (before.length !== after.length) return undefined;
  const positions = new Map<jsonTypes.JsonValue, { indices: number[]; used: number }>();
  for (let index = 0; index < before.length; index++) {
    const value = before[index]!;
    const entry = positions.get(value);
    if (entry === undefined) positions.set(value, { indices: [index], used: 0 });
    else entry.indices.push(index);
  }
  const result = new Array<number>(after.length);
  for (let index = 0; index < after.length; index++) {
    const entry = positions.get(after[index]!);
    if (entry === undefined || entry.used === entry.indices.length) return undefined;
    result[index] = entry.indices[entry.used++]!;
  }
  return result;
};

const stringEmitted = (
  before: string,
  after: string,
  path: opsTypes.NonEmptyPath,
  operations: opsTypes.Op[],
): void => {
  if (before === after) return;
  if (after.length > before.length && after.slice(0, before.length) === before) {
    emitOperation(operations, ["a", path, after.slice(before.length)]);
    return;
  }
  const shared = overlap(before, after, DEFAULT_OVERLAP_SCAN);
  if (shared === 0) {
    emitOperation(operations, ["s", path, after]);
    return;
  }
  emitOperation(operations, ["t", path, before.length - shared]);
  if (after.length > shared) emitOperation(operations, ["a", path, after.slice(shared)]);
};
const overflowed = (operations: opsTypes.Op[]): boolean => overflowedBatches.has(operations);

const markOverflowed = (operations: opsTypes.Op[]): void => {
  overflowedBatches.add(operations);
};

const emitOperation: {
  (operation: opsTypes.Op): (operations: opsTypes.Op[]) => void;
  (operations: opsTypes.Op[], operation: opsTypes.Op): void;
} = dual(2, operationEmitted);

const emitSet: {
  (value: jsonTypes.JsonValue, operations: opsTypes.Op[]): (path: opsTypes.Path) => void;
  (path: opsTypes.Path, value: jsonTypes.JsonValue, operations: opsTypes.Op[]): void;
} = dual(3, setEmitted);

const equalJson: {
  (right: jsonTypes.JsonValue): (left: jsonTypes.JsonValue) => boolean;
  (left: jsonTypes.JsonValue, right: jsonTypes.JsonValue): boolean;
} = dual(2, jsonEqual);

const permutation: {
  (
    after: readonly jsonTypes.JsonValue[],
  ): (before: readonly jsonTypes.JsonValue[]) => number[] | undefined;
  (
    before: readonly jsonTypes.JsonValue[],
    after: readonly jsonTypes.JsonValue[],
  ): number[] | undefined;
} = dual(2, permutationOf);

const emitString: {
  (after: string, path: opsTypes.NonEmptyPath, operations: opsTypes.Op[]): (before: string) => void;
  (before: string, after: string, path: opsTypes.NonEmptyPath, operations: opsTypes.Op[]): void;
} = dual(4, stringEmitted);

const diffEmit = {
  emitOperation,
  emitSet,
  emitString,
  equalJson,
  isContainer,
  markOverflowed,
  overflowed,
  permutation,
};

export default diffEmit;
