import { describe, expect, it } from "vite-plus/test";

import delta from "../src/delta/index.ts";
import type deltaTypes from "../src/delta/index.types.ts";

const { UnsafePathError, apply, applyImmutable, decoder, encoder, isBase } = delta;
const assertValidOp: typeof delta.assertValidOp = delta.assertValidOp;
const assertValidWireOp: typeof delta.assertValidWireOp = delta.assertValidWireOp;

const appliesMutableAndImmutableOperations = (): void => {
  const operations: deltaTypes.Op[] = [
    ["a", ["text"], "b"],
    ["p", ["values"], 1, 1, [3, 4]],
    ["s", ["nested", "value"], 2],
  ];
  const base = { nested: { value: 1 }, stable: { value: 9 }, text: "a", values: [1, 2] };
  const immutable = applyImmutable(base, operations);
  expect(immutable).toEqual({
    nested: { value: 2 },
    stable: { value: 9 },
    text: "ab",
    values: [1, 3, 4],
  });
  expect(base).toEqual({ nested: { value: 1 }, stable: { value: 9 }, text: "a", values: [1, 2] });
  expect(immutable.stable).toBe(base.stable);
  expect(apply(structuredClone(base), operations)).toEqual(immutable);
};

const supportsRootReplacementRootSpliceAnd = (): void => {
  const base: deltaTypes.Op[] = [["r", [1, 2, 3]]];
  expect(isBase(base)).toBe(true);
  let value = apply<number[]>(undefined, base);
  value = apply(value, [["p", [], 1, 1, [4]]]);
  value = apply(value, [["m", [], [2, 0, 1]]]);
  expect(value).toEqual([3, 1, 4]);
};

const rejectsUnsafeAndMalformedPaths = (): void => {
  expect(() => apply({}, [["s", ["constructor", "prototype", "x"], true]])).toThrow(
    UnsafePathError,
  );
  expect(() => apply({ values: [1] }, [["s", ["values", 3], 2]])).toThrow(UnsafePathError);
  expect(() => apply({ value: 1 }, [["a", ["value"], "x"]])).toThrow();
  expect(() => assertValidOp(["s", "value", 1] as never)).toThrow();
  expect(() => assertValidOp(["m", [], [0, 0]] as never)).toThrow(/bijection/u);
};

const validatesImmutableOperationsBeforeTraversingThe = (): void => {
  let reads = 0;
  const target = Object.defineProperty({}, "trap", {
    enumerable: true,
    get() {
      reads += 1;
      return {};
    },
  });
  expect(() => applyImmutable(target, [["s", "bad-path", 1] as never])).toThrow(/path/u);
  expect(reads).toBe(0);
};

const validatesDecodedAndWireVocabulariesSeparately = (): void => {
  expect(() => assertValidOp(["s", ["value"], 1])).not.toThrow();
  expect(() => assertValidOp(["s", 1] as never)).toThrow();
  expect(() => assertValidWireOp(["s", 1])).not.toThrow();
  expect(() => assertValidWireOp(["#", 0, ["value"]])).not.toThrow();
};

describe("operation application and validation", () => {
  it("applies mutable and immutable operations", appliesMutableAndImmutableOperations);

  it(
    "supports root replacement, root splice, and permutations",
    supportsRootReplacementRootSpliceAnd,
  );

  it("rejects unsafe and malformed paths", rejectsUnsafeAndMalformedPaths);

  it(
    "validates immutable operations before traversing the target",
    validatesImmutableOperationsBeforeTraversingThe,
  );

  it(
    "validates decoded and wire vocabularies separately",
    validatesDecodedAndWireVocabulariesSeparately,
  );
});

const internsPathsOmitsAdjacentPathsAnd = (): void => {
  const path = ["nested", "text"] as const;
  const enc = encoder();
  const dec = decoder();
  const first: deltaTypes.Op[] = [
    ["t", path, 1],
    ["a", path, "x"],
  ];
  expect(dec.decode(enc.encode(first))).toEqual(first);
  const second: deltaTypes.Op[] = [["a", path, "y"]];
  const wire = enc.encode(second);
  expect(wire).toEqual([
    ["#", 0, path],
    ["a", 0, "y"],
  ]);
  expect(dec.decode(wire)).toEqual(second);
};

const resetsPathDictionariesOnABase = (): void => {
  const enc = encoder();
  const path = ["value"] as const;
  enc.encode([["s", path, 1]]);
  enc.encode([["s", path, 2]]);
  expect(enc.encode([["r", { value: 3 }]])).toEqual([["r", { value: 3 }]]);
  expect(enc.encode([["s", path, 4]])).toEqual([["s", path, 4]]);
};

const rejectsUnresolvedShortFormsAndUnsafe = (): void => {
  expect(() => decoder().decode([["a", "x"]])).toThrow();
  const wire = [
    ["#", 0, ["__proto__"]],
    ["s", 0, true],
  ] as unknown as deltaTypes.WireOp[];
  expect(() => decoder().decode(wire)).toThrow(UnsafePathError);
};

const omitsAnAdjacentRepeatedPath = (): void => {
  const enc = encoder();
  const path = ["value"] as const;
  expect(
    enc.encode([
      ["s", path, 1],
      ["s", path, 2],
    ]),
  ).toEqual([
    ["s", path, 1],
    ["s", 2],
  ]);
};

const internsOnSecondUseRatherThan = (): void => {
  const enc = encoder();
  const path = ["a", "deep"] as const;
  expect(enc.encode([["a", path, "1"]])).toEqual([["a", path, "1"]]);
  expect(enc.encode([["a", path, "2"]])).toEqual([
    ["#", 0, path],
    ["a", 0, "2"],
  ]);
};

const doesNotCollidePathsContainingNull = (): void => {
  const operations: deltaTypes.Op[] = [
    ["s", ["a\u0000b"], 1],
    ["s", ["a", "b"], 2],
  ];
  expect(decoder().decode(encoder().encode(operations))).toEqual(operations);
};

const clearsDecoderIdsOnABase = (): void => {
  const dec = decoder();
  dec.decode([
    ["#", 0, ["a"]],
    ["a", 0, "1"],
  ]);
  dec.decode([["r", { a: "" }]]);
  expect(() => dec.decode([["a", 0, "2"]])).toThrow();
};

const makesBatchesAfterABaseSelf = (): void => {
  const enc = encoder();
  const path = ["a", "deep"] as const;
  enc.encode([["a", path, "1"]]);
  enc.encode([["a", path, "2"]]);
  const base = enc.encode([["r", { a: { deep: "x" } }]]);
  const after = enc.encode([["a", path, "3"]]);
  expect(after).toEqual([["a", path, "3"]]);
  const dec = decoder();
  expect(dec.decode(base)).toEqual([["r", { a: { deep: "x" } }]]);
  expect(dec.decode(after)).toEqual([["a", path, "3"]]);
};

const roundTripsDeterministicMixedOperationStreams = (): void => {
  const batches: deltaTypes.Op[][] = Array.from({ length: 100 }, (_, index) => [
    ["s", ["rows", index, "value"], index],
    ["a", ["output"], String(index)],
    ["p", ["tail"], index, 0, [index]],
  ]);
  const enc = encoder();
  const dec = decoder();
  expect(batches.map((batch) => dec.decode(enc.encode(batch)))).toEqual(batches);
};

describe("codec", () => {
  it("interns paths, omits adjacent paths, and round-trips", internsPathsOmitsAdjacentPathsAnd);

  it("resets path dictionaries on a base", resetsPathDictionariesOnABase);

  it(
    "rejects unresolved short forms and unsafe interned paths",
    rejectsUnresolvedShortFormsAndUnsafe,
  );

  it("omits an adjacent repeated path", omitsAnAdjacentRepeatedPath);

  it("interns on second use rather than first", internsOnSecondUseRatherThan);

  it("does not collide paths containing null characters", doesNotCollidePathsContainingNull);

  it("clears decoder ids on a base batch", clearsDecoderIdsOnABase);

  it("makes batches after a base self-contained", makesBatchesAfterABaseSelf);

  it(
    "round-trips deterministic mixed operation streams",
    roundTripsDeterministicMixedOperationStreams,
  );
});

const doesNotMutateAReplacementPayload = (): void => {
  const replacement = { nested: { value: 1 } };
  const next = applyImmutable<{ nested: { value: number } }>(undefined, [
    ["r", replacement],
    ["s", ["nested", "value"], 2],
  ]);
  expect(replacement.nested.value).toBe(1);
  expect(next.nested.value).toBe(2);
};

const adoptsAMutableReplacementPayloadRather = (): void => {
  const batch: deltaTypes.Op[] = [["r", { value: 0 }]];
  const first = apply<{ value: number }>(undefined, batch);
  const second = apply<{ value: number }>(undefined, batch);
  first.value = 1;
  expect(second.value).toBe(1);
};

describe("immutable application ownership", () => {
  it(
    "does not mutate a replacement payload targeted by a later operation",
    doesNotMutateAReplacementPayload,
  );

  it(
    "adopts a mutable replacement payload rather than copying it",
    adoptsAMutableReplacementPayloadRather,
  );
});
