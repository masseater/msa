import type { JsonValue } from "../json.ts";
import type { NonEmptyPath, Op, Path, PathRef, WireOp } from "./ops.ts";
import { PathError } from "./path-error.ts";
import { assertSafePath } from "./validate.ts";
import { assertValidWireOp } from "./wire-ops.ts";

export interface Decoder {
  decode(wire: readonly unknown[]): Op[];
}

type WirePathOp = Exclude<WireOp, { 0: "r" | "#" }>;

const isShort = (op: WirePathOp): boolean =>
  (op[0] === "d" && op.length === 1) ||
  (op[0] !== "d" && op[0] !== "p" && op.length === 2) ||
  (op[0] === "p" && op.length === 4);

const decoded = (op: WirePathOp, path: Path, short: boolean): Op => {
  switch (op[0]) {
    case "s":
      return ["s", path as NonEmptyPath, (short ? op[1] : op[2]) as JsonValue];
    case "d":
      return ["d", path as NonEmptyPath];
    case "a":
      return ["a", path as NonEmptyPath, (short ? op[1] : op[2]) as string];
    case "t":
      return ["t", path as NonEmptyPath, (short ? op[1] : op[2]) as number];
    case "p": {
      const [index, removed, items] = short
        ? [op[1] as number, op[2] as number, op[3] as JsonValue[]]
        : [op[2] as number, op[3] as number, op[4] as JsonValue[]];
      return ["p", path, index, removed, items];
    }
    case "m":
      return ["m", path, (short ? op[1] : op[2]) as number[]];
  }
};

export function decoder(): Decoder {
  const paths = new Map<number, Path>();

  return {
    decode(wire) {
      let previous: Path | undefined;
      const out: Op[] = [];
      for (const op of wire) {
        assertValidWireOp(op);
        if (op[0] === "#") {
          assertSafePath(op[2]);
          paths.set(op[1], op[2]);
          continue;
        }
        if (op[0] === "r") {
          out.push(op);
          paths.clear();
          previous = undefined;
          continue;
        }
        const short = isShort(op);
        let path: Path;
        if (short) {
          if (previous === undefined) throw new PathError([]);
          path = previous;
        } else {
          const ref = op[1] as PathRef;
          if (typeof ref === "number") {
            const resolved = paths.get(ref);
            if (resolved === undefined) throw new PathError(ref);
            path = resolved;
          } else path = ref;
          previous = path;
        }
        if (op[0] !== "p" && op[0] !== "m" && path.length === 0) throw new PathError(path);
        out.push(decoded(op, path, short));
      }
      return out;
    },
  };
}
