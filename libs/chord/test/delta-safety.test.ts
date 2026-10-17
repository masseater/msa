import { DateTime } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  apply,
  assertValidOp,
  assertValidWireOp,
  decoder,
  type JsonValue,
  track,
  type WireOp,
} from "../src/delta/index.ts";

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
  expect(() =>
    assertValidWireOp(["r", DateTime.toDateUtc(DateTime.nowUnsafe())] as never),
  ).not.toThrow();
};

describe("operation assertions", () => {
  it(
    "accepts decoded operations and rejects wire-only forms",
    acceptsDecodedOperationsAndRejectsWire,
  );

  it("does not recursively inspect operation payloads", doesNotRecursivelyInspectOperationPayloads);
});
