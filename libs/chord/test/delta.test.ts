import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  apply,
  applyImmutable,
  assertValidOp,
  assertValidWireOp,
  decoder,
  encoder,
  isBase,
  type JsonValue,
  type Op,
  overlap,
  track,
  UnsafePathError,
  type WireOp,
} from "../src/delta/index.ts";

const keepsADraftAliveAcrossAwait = Effect.gen(function* () {
  const input = { count: 1, nested: { text: "a" }, values: [1] };
  const tracker = track(input);
  expect(tracker.value).toBe(input);
  expect(Object.isFrozen(tracker.value)).toBe(false);
  expect(Object.isFrozen(tracker.value.nested)).toBe(false);

  const change = tracker.beginChange();
  change.state.count = 2;
  yield* Effect.promise(() => Promise.resolve());
  change.state.nested.text += "b";
  change.state.values.push(2);
  expect(tracker.value).toEqual(input);

  const prepared = change.prepare();
  expect(prepared.base).toBe(tracker.value);
  expect(prepared.value).toEqual({ count: 2, nested: { text: "ab" }, values: [1, 2] });
  expect(prepared.ops).toEqual([
    ["s", ["count"], 2],
    ["a", ["nested", "text"], "b"],
    ["p", ["values"], 1, 0, [2]],
  ]);
  expect(() => change.state.count).toThrow(TypeError);
  expect(tracker.value).toEqual(input);

  tracker.adopt(prepared);
  expect(tracker.value).toBe(prepared.value);
});

const abortsAndRevokesWithoutChangingThe = (): void => {
  const tracker = track({ child: { value: 1 } });
  const change = tracker.beginChange();
  const child = change.state.child;
  child.value = 2;
  change.abort();
  expect(tracker.value.child.value).toBe(1);
  expect(() => child.value).toThrow(TypeError);
  expect(() => change.abort()).not.toThrow();
  expect(() => change.prepare()).toThrow(/settled/u);
  const next = tracker.beginChange();
  next.abort();
};

const growsArraysWithExplicitNullsAnd = (): void => {
  const tracker = track({ values: [1, 2] as Array<number | null> });
  const change = tracker.beginChange();
  change.state.values.length = 4;
  const prepared = change.prepare();
  expect(prepared.value.values).toEqual([1, 2, null, null]);
  expect(() => change.state.values).toThrow(TypeError);
  tracker.adopt(prepared);
};

const normalizesADeepNoOpTo = (): void => {
  const tracker = track({ value: { nested: [1, 2] } });
  const change = tracker.beginChange();
  change.state.value = { nested: [1, 2] };
  const prepared = change.prepare();
  expect(prepared.value).toBe(prepared.base);
  expect(prepared.ops).toEqual([]);
  tracker.adopt(prepared);
  expect(tracker.value).toBe(prepared.base);
};

const takesImmutableOwnershipOfReplacementInput = (): void => {
  const tracker = track({ nested: { value: 1 } });
  const replacement = { nested: { value: 2 } };
  const prepared = tracker.prepareReplace(replacement);
  expect(prepared.value).toBe(replacement);
  expect(prepared.ops).toEqual([["r", replacement]]);
  tracker.adopt(prepared);

  const noOp = tracker.prepareReplace({ nested: { value: 2 } });
  expect(noOp.value).toBe(tracker.value);
  expect(noOp.ops).toEqual([]);
};

const sharesImmutableOperationPlacementsWithThe = (): void => {
  const tracker = track({ rows: [] as { id: number }[] });
  const change = tracker.beginChange();
  change.state.rows.push({ id: 1 });
  const prepared = change.prepare();
  const splice = prepared.ops[0]!;
  if (splice[0] !== "p") throw new Error("expected splice");
  expect(splice[4][0]).toBe(prepared.value.rows[0]);
  expect(Object.isFrozen(prepared)).toBe(false);
  expect(Object.isFrozen(prepared.ops)).toBe(false);
};

const rejectsForeignStaleAndRepeatedPreparations = (): void => {
  const first = track({ value: 0 });
  const second = track({ value: 0 });
  const change = first.beginChange();
  const competing = first.beginChange();
  change.state.value = 1;
  competing.state.value = 2;
  const prepared = change.prepare();
  const competingPrepared = competing.prepare();
  expect(() => second.adopt(prepared)).toThrow(/different tracker/u);
  first.adopt(prepared);
  expect(() => first.adopt(prepared)).toThrow(/already been used/u);
  expect(() => first.adopt(competingPrepared)).toThrow(/stale/u);

  const stale = first.prepareReplace({ value: 2 });
  const winner = first.prepareReplace({ value: 3 });
  first.adopt(winner);
  expect(() => first.adopt(stale)).toThrow(/stale/u);
  expect(() => first.adopt(stale)).toThrow(/stale/u);
};

const invalidatesAPreparedResultWhenIts = (): void => {
  const tracker = track({ value: 0 });
  const change = tracker.beginChange();
  change.state.value = 1;
  const prepared = change.prepare();
  change.abort();
  expect(() => tracker.adopt(prepared)).toThrow(/aborted/u);
  expect(() => change.abort()).not.toThrow();
};

const makesCompetingSameBasePreparationsStale = (): void => {
  const tracker = track({ value: { count: 1 } });
  const first = tracker.prepareReplace({ value: { count: 1 } });
  const competing = tracker.prepareReplace({ value: { count: 1 } });
  expect(first.value).toBe(first.base);
  expect(competing.value).toBe(competing.base);
  tracker.adopt(first);
  expect(() => tracker.adopt(first)).toThrow(/already been used/u);
  expect(() => tracker.adopt(competing)).toThrow(/stale/u);
};

const emitsAnOwnedRootReplacementWithout = (): void => {
  const rows = Array.from({ length: 10_000 }, (_, value) => ({ value, stable: { value } }));
  const tracker = track({ rows });
  const replacement = { rows: tracker.value.rows.slice() };
  replacement.rows[5_000] = { value: -1, stable: replacement.rows[5_000]!.stable };
  const prepared = tracker.prepareReplace(replacement);
  expect(prepared.value).toBe(replacement);
  expect(prepared.ops).toEqual([["r", replacement]]);
  expect(applyImmutable(prepared.base, prepared.ops)).toEqual(prepared.value);
};

describe("immutable tracker lifecycle", () => {
  it("keeps a draft alive across await and adopts only a prepared change", () =>
    Effect.runPromise(keepsADraftAliveAcrossAwait));

  it("aborts and revokes without changing the committed value", abortsAndRevokesWithoutChangingThe);

  it(
    "grows arrays with explicit nulls and revokes drafts after preparation",
    growsArraysWithExplicitNullsAnd,
  );

  it("normalizes a deep no-op to exact previous identity", normalizesADeepNoOpTo);

  it(
    "takes immutable ownership of replacement input and applies no-op normalization",
    takesImmutableOwnershipOfReplacementInput,
  );

  it(
    "shares immutable operation placements with the prepared candidate",
    sharesImmutableOperationPlacementsWithThe,
  );

  it(
    "rejects foreign, stale, and repeated preparations while allowing competing changes",
    rejectsForeignStaleAndRepeatedPreparations,
  );

  it("invalidates a prepared result when its change is aborted", invalidatesAPreparedResultWhenIts);

  it(
    "makes competing same-base preparations stale after adopting a no-op",
    makesCompetingSameBasePreparationsStale,
  );

  it(
    "emits an owned root replacement without traversing large replacement input",
    emitsAnOwnedRootReplacementWithout,
  );
});

const emitsAppendAndRollingWindowOperations = (): void => {
  const tracker = track({ text: "abcdefgh" });
  let change = tracker.beginChange();
  change.state.text += "ij";
  let prepared = change.prepare();
  expect(prepared.ops).toEqual([["a", ["text"], "ij"]]);
  tracker.adopt(prepared);

  change = tracker.beginChange();
  change.state.text = `${change.state.text.slice(3)}xyz`;
  prepared = change.prepare();
  expect(prepared.ops).toEqual([
    ["t", ["text"], 3],
    ["a", ["text"], "xyz"],
  ]);
};

const findsBoundedOverlaps = (): void => {
  expect(overlap("abcdefgh", "defghxyz", 65_536)).toBe(5);
  expect(overlap("abcdef", "defghi", 0)).toBe(0);
};

describe("canonical strings", () => {
  it("emits append and rolling-window operations", emitsAppendAndRollingWindowOperations);

  it("finds bounded overlaps", findsBoundedOverlaps);
});

const appliesMutableAndImmutableOperations = (): void => {
  const operations: Op[] = [
    ["a", ["text"], "b"],
    ["p", ["values"], 1, 1, [3, 4]],
    ["s", ["nested", "value"], 2],
  ];
  const base = { text: "a", values: [1, 2], nested: { value: 1 }, stable: { value: 9 } };
  const immutable = applyImmutable(base, operations);
  expect(immutable).toEqual({
    text: "ab",
    values: [1, 3, 4],
    nested: { value: 2 },
    stable: { value: 9 },
  });
  expect(base).toEqual({ text: "a", values: [1, 2], nested: { value: 1 }, stable: { value: 9 } });
  expect(immutable.stable).toBe(base.stable);
  expect(apply(structuredClone(base), operations)).toEqual(immutable);
};

const supportsRootReplacementRootSpliceAnd = (): void => {
  const base: Op[] = [["r", [1, 2, 3]]];
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
  const first: Op[] = [
    ["t", path, 1],
    ["a", path, "x"],
  ];
  expect(dec.decode(enc.encode(first))).toEqual(first);
  const second: Op[] = [["a", path, "y"]];
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
  ] as unknown as WireOp[];
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
  const operations: Op[] = [
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
  const batches: Op[][] = Array.from({ length: 100 }, (_, index) => [
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
  const batch: Op[] = [["r", { value: 0 }]];
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

const rejectsConstructorWalksAndForbiddenInterned = (): void => {
  expect(() =>
    apply({}, JSON.parse('[["s",["constructor","prototype","gadget"],true]]')),
  ).toThrow();
  expect(({} as Record<string, unknown>)["gadget"]).toBeUndefined();
  const wire = [
    ["#", 0, ["__proto__", "w"]],
    ["s", 0, true],
  ] as unknown as WireOp[];
  expect(() => decoder().decode(wire)).toThrow();
};

const doesNotRunInheritedSetters = (): void => {
  Object.defineProperty(Object.getPrototypeOf({}), "trap", {
    get() {
      return undefined;
    },
    set() {
      throw new Error("inherited setter ran");
    },
    configurable: true,
  });
  try {
    expect(() => apply({}, [["s", ["trap"], 1]])).not.toThrow();
    expect(apply({}, [["s", ["trap"], 1]])).toEqual({ trap: 1 });
  } finally {
    delete (Object.prototype as Record<string, unknown>)["trap"];
  }
};

const allowsReservedNamesInsideValuesWithout = (): void => {
  const value = JSON.parse('{"__proto__":{"z":1}}') as JsonValue;
  const out = apply({}, [["s", ["value"], value]]);
  expect(Object.hasOwn((out as { value: object }).value, "__proto__")).toBe(true);
  expect(({} as Record<string, unknown>)["z"]).toBeUndefined();
};

const importsOwnPropertiesWithoutInvokingInherited = (): void => {
  const root = {} as Record<string, JsonValue>;
  Object.defineProperty(root, "trap", {
    value: 1,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(Object.getPrototypeOf({}), "trap", {
    get() {
      return undefined;
    },
    set() {
      throw new Error("inherited setter ran");
    },
    configurable: true,
  });
  try {
    expect(() => track(root)).not.toThrow();
  } finally {
    delete (Object.prototype as Record<string, unknown>)["trap"];
  }

  let value: { values: number[] } | undefined;
  Object.defineProperty(Object.getPrototypeOf([]), "0", {
    get() {
      return undefined;
    },
    set() {
      throw new Error("inherited array setter ran");
    },
    configurable: true,
  });
  try {
    value = track({ values: [1, 2] }).value;
  } finally {
    delete (Array.prototype as unknown as Record<number, unknown>)[0];
  }
  expect(value).toEqual({ values: [1, 2] });
};

describe("path and prototype safety", () => {
  it(
    "rejects constructor walks and forbidden interned paths",
    rejectsConstructorWalksAndForbiddenInterned,
  );

  it("does not run inherited setters", doesNotRunInheritedSetters);

  it(
    "allows reserved names inside values without prototype pollution",
    allowsReservedNamesInsideValuesWithout,
  );

  it(
    "imports own properties without invoking inherited setters",
    importsOwnPropertiesWithoutInvokingInherited,
  );
});

const writesAnExistingIndexAndAppends = (): void => {
  expect(apply({ values: [1, 2, 3] }, [["s", ["values", 1], 9]])).toEqual({ values: [1, 9, 3] });
  expect(apply({ values: [1, 2, 3] }, [["s", ["values", 3], 9]])).toEqual({
    values: [1, 2, 3, 9],
  });
};

const rejectsGapsHugeIndicesAndString = (): void => {
  expect(() => apply({ values: [1, 2, 3] }, [["s", ["values", 5], 9]])).toThrow();
  expect(() => apply({ values: [] }, [["s", ["values", 4_294_967_290], 1]])).toThrow();
  expect(() => apply({ values: [1] }, [["s", ["values", "0"], 9]])).toThrow();
  expect(() => apply({ values: ["a"] }, [["a", ["values", "0"], "b"]])).toThrow();
};

const allowsExplicitGrowthValuesAndRejects = (): void => {
  expect(apply({ values: [1] }, [["p", ["values"], 1, 0, [null, null, 9]]])).toEqual({
    values: [1, null, null, 9],
  });
  expect(() => apply({ values: [1] }, [["d", ["values", 1]]])).toThrow();
};

const appliesLargeSplicePayloadsWithoutSpreading = (): void => {
  const items = Array<JsonValue>(300_000).fill(null);
  const result = apply({ values: [] as JsonValue[] }, [["p", ["values"], 0, 0, items]]);
  expect(result.values).toHaveLength(items.length);
};

describe("array index safety", () => {
  it(
    "writes an existing index and appends exactly one past the end",
    writesAnExistingIndexAndAppends,
  );

  it("rejects gaps, huge indices, and string-spelled indices", rejectsGapsHugeIndicesAndString);

  it(
    "allows explicit growth values and rejects deletion past the end",
    allowsExplicitGrowthValuesAndRejects,
  );

  it(
    "applies large splice payloads without spreading them at once",
    appliesLargeSplicePayloadsWithoutSpreading,
  );
});

const rejectsUnknownVerbsMalformedTuplesPaths = (): void => {
  expect(() => apply({ value: 1 }, [["ZZZ", ["value"], 9] as never])).toThrow();
  expect(() =>
    apply({ values: [1] }, [["p", ["values"], 0, 0, "not-an-array"] as never]),
  ).toThrow();
  expect(() => apply({ value: 1 }, [["s", "value", 9] as never])).toThrow();
  expect(() => apply({ value: 1 }, [{ op: "s" } as never])).toThrow();
  expect(() => apply({ value: 1 }, [null as never])).toThrow();
};

const rejectsInvalidAppendAndTruncationOperations = (): void => {
  expect(() => apply({ value: 1 }, [["a", ["missing"], "x"]])).toThrow();
  expect(() => apply({ value: 1 }, [["a", ["value"], "x"]])).toThrow();
  expect(() => apply({ value: "abc" }, [["t", ["value"], -1]])).toThrow();
  expect(() => decoder().decode([["t", ["value"], -1]])).toThrow();
};

const clampsSpliceRemovalPastTheEnd = (): void => {
  expect(apply({ values: [1, 2] }, [["p", ["values"], 0, 1e9, []]])).toEqual({ values: [] });
};

describe("operation structure safety", () => {
  it(
    "rejects unknown verbs, malformed tuples, paths, and splice payloads",
    rejectsUnknownVerbsMalformedTuplesPaths,
  );

  it(
    "rejects invalid append and truncation operations",
    rejectsInvalidAppendAndTruncationOperations,
  );

  it("clamps splice removal past the end", clampsSpliceRemovalPastTheEnd);
});

const acceptsDecodedOperationsAndRejectsWire = (): void => {
  for (const operation of [
    ["r", { value: 1 }],
    ["s", ["value"], 1],
    ["d", ["value"]],
    ["a", ["value"], "x"],
    ["t", ["value"], 2],
    ["p", ["value"], 0, 0, []],
    ["m", ["value"], [0]],
  ] as never[]) {
    expect(() => assertValidOp(operation)).not.toThrow();
  }
  for (const wireOnly of [
    ["s", 1],
    ["d"],
    ["a", "x"],
    ["t", 2],
    ["p", 0, 0, []],
    ["#", 0, ["value"]],
    ["s", 0, 1],
  ] as never[]) {
    expect(() => assertValidOp(wireOnly)).toThrow();
    expect(() => assertValidWireOp(wireOnly)).not.toThrow();
  }
};

const doesNotRecursivelyInspectOperationPayloads = (): void => {
  expect(() => assertValidOp(["s", ["value"], new Map()] as never)).not.toThrow();
  expect(() => assertValidWireOp(["r", new Date()] as never)).not.toThrow();
};

describe("operation assertions", () => {
  it(
    "accepts decoded operations and rejects wire-only forms",
    acceptsDecodedOperationsAndRejectsWire,
  );

  it("does not recursively inspect operation payloads", doesNotRecursivelyInspectOperationPayloads);
});
