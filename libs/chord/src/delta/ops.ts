import type { JsonValue } from "../json.ts";

export const isObj = (value: unknown): value is object =>
  value !== null && typeof value === "object";

export type Seg = string | number;
export type Path = readonly Seg[];
export type NonEmptyPath = readonly [Seg, ...Seg[]];

export type PathRef<P extends Path = Path> = P | number;

export type Op =
  | readonly ["r", JsonValue]
  | readonly ["s", NonEmptyPath, JsonValue]
  | readonly ["d", NonEmptyPath]
  | readonly ["a", NonEmptyPath, string]
  | readonly ["t", NonEmptyPath, number]
  | readonly ["p", Path, number, number, JsonValue[]]
  | readonly ["m", Path, number[]];

export type WireOp =
  | readonly ["r", JsonValue]
  | readonly ["s", PathRef<NonEmptyPath>, JsonValue]
  | readonly ["s", JsonValue]
  | readonly ["d", PathRef<NonEmptyPath>]
  | readonly ["d"]
  | readonly ["a", PathRef<NonEmptyPath>, string]
  | readonly ["a", string]
  | readonly ["t", PathRef<NonEmptyPath>, number]
  | readonly ["t", number]
  | readonly ["p", PathRef, number, number, JsonValue[]]
  | readonly ["p", number, number, JsonValue[]]
  | readonly ["m", PathRef, number[]]
  | readonly ["m", number[]]
  | readonly ["#", number, Path];

export const isReplace = (op: Op | WireOp): boolean => op[0] === "r";

export const isBase = (ops: readonly (Op | WireOp)[]): boolean =>
  ops.length > 0 && ops[0]![0] === "r";

export const RESERVED_SEGMENTS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

export const pathKey = (path: Path): string => JSON.stringify(path);
