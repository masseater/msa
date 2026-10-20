import type jsonTypes from "../json.types.ts";
import type decodeTypes from "./decode.types.ts";
import type opsTypes from "./ops.types.ts";
import PathError from "./path-error.ts";
import validate from "./validate.ts";
import wireOps from "./wire-ops.ts";

const assertValidWireOp: typeof wireOps.assertValidWireOp = wireOps.assertValidWireOp;
const { assertSafePath } = validate;

type WirePathOp = Exclude<opsTypes.WireOp, { 0: "r" | "#" }>;

const isShort = (op: WirePathOp): boolean =>
  (op[0] === "d" && op.length === 1) ||
  (op[0] !== "d" && op[0] !== "p" && op.length === 2) ||
  (op[0] === "p" && op.length === 4);

const decoded = (op: WirePathOp, path: opsTypes.Path, short: boolean): opsTypes.Op => {
  switch (op[0]) {
    case "s":
      return ["s", path as opsTypes.NonEmptyPath, (short ? op[1] : op[2]) as jsonTypes.JsonValue];
    case "d":
      return ["d", path as opsTypes.NonEmptyPath];
    case "a":
      return ["a", path as opsTypes.NonEmptyPath, (short ? op[1] : op[2]) as string];
    case "t":
      return ["t", path as opsTypes.NonEmptyPath, (short ? op[1] : op[2]) as number];
    case "p": {
      const [index, removed, items] = short
        ? [op[1] as number, op[2] as number, op[3] as jsonTypes.JsonValue[]]
        : [op[2] as number, op[3] as number, op[4] as jsonTypes.JsonValue[]];
      return ["p", path, index, removed, items];
    }
    case "m":
      return ["m", path, (short ? op[1] : op[2]) as number[]];
  }
};

function decoder(): decodeTypes.Decoder {
  const paths = new Map<number, opsTypes.Path>();

  return {
    decode(wire) {
      let previous: opsTypes.Path | undefined;
      const out: opsTypes.Op[] = [];
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
        let path: opsTypes.Path;
        if (short) {
          if (previous === undefined) throw new PathError([]);
          path = previous;
        } else {
          const ref = op[1] as opsTypes.PathRef;
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

const decodeModule = {
  decoder,
};

export default decodeModule;
