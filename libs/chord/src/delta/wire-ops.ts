import type { Path, WireOp } from "./ops.ts";
import { assertPermutation, assertSafePath } from "./validate.ts";

const checkRef = (r: unknown): void => {
  if (typeof r === "number") {
    if (!Number.isInteger(r) || r < 0) throw new TypeError("bad path id");
    return;
  }
  if (!Array.isArray(r)) throw new TypeError("path is not an array");
  assertSafePath(r as Path);
};

const checkRefOnly = (op: readonly unknown[], verb: string, long: number): void => {
  if (op.length === long) checkRef(op[1]);
  else if (op.length !== long - 1) throw new TypeError(`${verb} arity`);
};

const checkLeaf = (op: readonly unknown[], verb: "a" | "t"): void => {
  if (op.length !== 2 && op.length !== 3) throw new TypeError(`${verb} arity`);
  if (op.length === 3) checkRef(op[1]);
  const value = op[op.length - 1];
  if (verb === "a") {
    if (typeof value !== "string") throw new TypeError("a value");
    return;
  }
  if (!Number.isInteger(value) || (value as number) < 0) throw new TypeError("t count");
};

const checkSplice = (op: readonly unknown[]): void => {
  const [i, r, items] =
    op.length === 5 ? [op[2], op[3], op[4]] : op.length === 4 ? [op[1], op[2], op[3]] : [];
  if (items === undefined) throw new TypeError("p arity");
  if (op.length === 5) checkRef(op[1]);
  if (!Number.isInteger(i) || (i as number) < 0) throw new TypeError("p index");
  if (!Number.isInteger(r) || (r as number) < 0) throw new TypeError("p remove");
  if (!Array.isArray(items)) throw new TypeError("p items");
};

const checkDeclaration = (op: readonly unknown[]): void => {
  if (
    op.length !== 3 ||
    !Number.isInteger(op[1]) ||
    (op[1] as number) < 0 ||
    !Array.isArray(op[2])
  ) {
    throw new TypeError("# shape");
  }
  assertSafePath(op[2] as Path);
};

export function assertValidWireOp(op: unknown): asserts op is WireOp {
  if (!Array.isArray(op) || op.length === 0) throw new TypeError("op is not a tuple");
  const [verb] = op as unknown[];
  switch (verb) {
    case "r":
      if (op.length !== 2) throw new TypeError("r arity");
      return;
    case "s":
      checkRefOnly(op, "s", 3);
      return;
    case "d":
      checkRefOnly(op, "d", 2);
      return;
    case "a":
    case "t":
      checkLeaf(op, verb);
      return;
    case "p":
      checkSplice(op);
      return;
    case "m":
      checkRefOnly(op, "m", 3);
      assertPermutation(op[op.length - 1]);
      return;
    case "#":
      checkDeclaration(op);
      return;
    default:
      throw new TypeError(`unknown op verb: ${String(verb)}`);
  }
}
