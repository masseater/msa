import type encodeTypes from "./encode.types.ts";
import opsModule from "./ops.ts";
import type opsTypes from "./ops.types.ts";

const { pathKey } = opsModule;

type PathOp = Exclude<opsTypes.Op, { 0: "r" }>;

const shortOp = (op: PathOp): opsTypes.WireOp => {
  switch (op[0]) {
    case "s":
      return ["s", op[2]];
    case "d":
      return ["d"];
    case "a":
      return ["a", op[2]];
    case "t":
      return ["t", op[2]];
    case "p":
      return ["p", op[2], op[3], op[4]];
    case "m":
      return ["m", op[2]];
  }
};

const longOp = (op: PathOp, ref: opsTypes.PathRef): opsTypes.WireOp => {
  switch (op[0]) {
    case "s":
      return ["s", ref as opsTypes.PathRef<opsTypes.NonEmptyPath>, op[2]];
    case "d":
      return ["d", ref as opsTypes.PathRef<opsTypes.NonEmptyPath>];
    case "a":
      return ["a", ref as opsTypes.PathRef<opsTypes.NonEmptyPath>, op[2]];
    case "t":
      return ["t", ref as opsTypes.PathRef<opsTypes.NonEmptyPath>, op[2]];
    case "p":
      return ["p", ref, op[2], op[3], op[4]];
    case "m":
      return ["m", ref, op[2]];
  }
};

function encoder(): encodeTypes.Encoder {
  const seen = new Set<string>();
  const ids = new Map<string, number>();
  let nextId = 0;
  let previous: string | undefined;

  const reference = (op: PathOp, key: string, out: opsTypes.WireOp[]): opsTypes.PathRef => {
    const existing = ids.get(key);
    if (existing !== undefined) return existing;
    if (seen.has(key)) {
      const id = nextId;
      nextId += 1;
      ids.set(key, id);
      out.push(["#", id, op[1]]);
      return id;
    }
    seen.add(key);
    return op[1];
  };

  return {
    encode(ops) {
      previous = undefined;
      const out: opsTypes.WireOp[] = [];
      for (const op of ops) {
        if (op[0] === "r") {
          out.push(op);
          seen.clear();
          ids.clear();
          nextId = 0;
          previous = undefined;
          continue;
        }
        const key = pathKey(op[1]);
        if (key === previous) {
          out.push(shortOp(op));
          continue;
        }
        out.push(longOp(op, reference(op, key, out)));
        previous = key;
      }
      return out;
    },
  };
}

const encodeModule = {
  encoder,
};

export default encodeModule;
