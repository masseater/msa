import { type Op, type Path, RESERVED_SEGMENTS } from "./ops.ts";
import { UnsafePathError } from "./unsafe-path-error.ts";

export function assertSafePath(path: Path): void {
  for (const seg of path) {
    if (typeof seg === "string") {
      if (RESERVED_SEGMENTS.has(seg)) throw new UnsafePathError(seg);
    } else if (!Number.isInteger(seg) || seg < 0) {
      throw new UnsafePathError(seg);
    }
  }
}

function assertPathArg(p: unknown, nonEmpty = false): void {
  if (!Array.isArray(p)) throw new TypeError("path is not an array");
  if (nonEmpty && p.length === 0) throw new TypeError("path is empty");
  assertSafePath(p as Path);
}

export function assertPermutation(value: unknown): asserts value is number[] {
  if (!Array.isArray(value)) throw new TypeError("m permutation is not an array");
  const seen = new Uint8Array(value.length);
  for (const index of value) {
    if (!Number.isInteger(index) || index < 0 || index >= value.length || seen[index] !== 0) {
      throw new TypeError("m permutation is not a bijection");
    }
    seen[index] = 1;
  }
}

export function assertValidOp(op: unknown): asserts op is Op {
  if (!Array.isArray(op) || op.length === 0) throw new TypeError("op is not a tuple");
  switch (op[0]) {
    case "r":
      if (op.length !== 2) throw new TypeError("r arity");
      return;
    case "s":
      if (op.length !== 3) throw new TypeError("s arity");
      assertPathArg(op[1], true);
      return;
    case "d":
      if (op.length !== 2) throw new TypeError("d arity");
      assertPathArg(op[1], true);
      return;
    case "a":
      if (op.length !== 3 || typeof op[2] !== "string") throw new TypeError("a shape");
      assertPathArg(op[1], true);
      return;
    case "t":
      if (op.length !== 3 || !Number.isInteger(op[2]) || op[2] < 0) throw new TypeError("t shape");
      assertPathArg(op[1], true);
      return;
    case "p": {
      if (op.length !== 5) throw new TypeError("p arity");
      assertPathArg(op[1]);
      if (!Number.isInteger(op[2]) || op[2] < 0) throw new TypeError("p index");
      if (!Number.isInteger(op[3]) || op[3] < 0) throw new TypeError("p remove");
      if (!Array.isArray(op[4])) throw new TypeError("p items");
      return;
    }
    case "m":
      if (op.length !== 3) throw new TypeError("m arity");
      assertPathArg(op[1]);
      assertPermutation(op[2]);
      return;
    default:
      throw new TypeError(`unknown op verb: ${String(op[0])}`);
  }
}
