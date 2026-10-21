import type opsTypes from "./ops.types.ts";

const isObj = (value: unknown): value is object => value !== null && typeof value === "object";

const isReplace = (op: opsTypes.Op | opsTypes.WireOp): boolean => op[0] === "r";

const isBase = (ops: readonly (opsTypes.Op | opsTypes.WireOp)[]): boolean =>
  ops.length > 0 && ops[0]![0] === "r";

const RESERVED_SEGMENTS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

const pathKey = (path: opsTypes.Path): string => JSON.stringify(path);

const opsModule = {
  RESERVED_SEGMENTS,
  isBase,
  isObj,
  isReplace,
  pathKey,
};

export default opsModule;
