import { dual } from "effect/Function";

import type { JsonValue } from "../json.ts";
import type { NonEmptyPath, Op, Path } from "./ops.ts";
import { overlap } from "./overlap.ts";

const DEFAULT_OVERLAP_SCAN = 65_536;
const MAX_DELTA_OPERATIONS = 4_096;
const overflowedBatches = new WeakSet<Op[]>();

const operationEmitted = (operations: Op[], operation: Op): void => {
  if (overflowedBatches.has(operations)) return;
  if (operations.length >= MAX_DELTA_OPERATIONS) {
    overflowedBatches.add(operations);
    return;
  }
  operations.push(operation);
};

export const isContainer = (value: JsonValue): value is JsonValue[] | Record<string, JsonValue> =>
  value !== null && typeof value === "object";

const setEmitted = (path: Path, value: JsonValue, operations: Op[]): void => {
  if (path.length === 0) emitOperation(operations, ["r", value]);
  else emitOperation(operations, ["s", path as NonEmptyPath, value]);
};

const jsonEqual = (left: JsonValue, right: JsonValue): boolean => {
  if (left === right) return true;
  if (!isContainer(left) || !isContainer(right) || Array.isArray(left) !== Array.isArray(right))
    return false;
  if (Array.isArray(left)) {
    const other = right as JsonValue[];
    if (left.length !== other.length) return false;
    for (let index = 0; index < left.length; index++) {
      if (!equalJson(left[index]!, other[index]!)) return false;
    }
    return true;
  }
  const other = right as Record<string, JsonValue>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(other).length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(other, key) || !equalJson(left[key]!, other[key]!)) return false;
  }
  return true;
};

const permutationOf = (
  before: readonly JsonValue[],
  after: readonly JsonValue[],
): number[] | undefined => {
  if (before.length !== after.length) return undefined;
  const positions = new Map<JsonValue, { indices: number[]; used: number }>();
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
  path: NonEmptyPath,
  operations: Op[],
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
export const overflowed = (operations: Op[]): boolean => overflowedBatches.has(operations);

export const markOverflowed = (operations: Op[]): void => {
  overflowedBatches.add(operations);
};

export const emitOperation: {
  (operation: Op): (operations: Op[]) => void;
  (operations: Op[], operation: Op): void;
} = dual(2, operationEmitted);

export const emitSet: {
  (value: JsonValue, operations: Op[]): (path: Path) => void;
  (path: Path, value: JsonValue, operations: Op[]): void;
} = dual(3, setEmitted);

export const equalJson: {
  (right: JsonValue): (left: JsonValue) => boolean;
  (left: JsonValue, right: JsonValue): boolean;
} = dual(2, jsonEqual);

export const permutation: {
  (after: readonly JsonValue[]): (before: readonly JsonValue[]) => number[] | undefined;
  (before: readonly JsonValue[], after: readonly JsonValue[]): number[] | undefined;
} = dual(2, permutationOf);

export const emitString: {
  (after: string, path: NonEmptyPath, operations: Op[]): (before: string) => void;
  (before: string, after: string, path: NonEmptyPath, operations: Op[]): void;
} = dual(4, stringEmitted);
