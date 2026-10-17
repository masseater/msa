import { describe, expect, test } from "vite-plus/test";

import { copyJson, isJsonValue } from "../src/index.ts";

const checksStrictJsonWithoutNormalizingIt = (): void => {
  expect(isJsonValue({ nested: [1, true, null] })).toBe(true);
  expect(isJsonValue({ omitted: undefined })).toBe(false);
  expect(isJsonValue(new Uint8Array([1]))).toBe(false);
  expect(isJsonValue(Number.POSITIVE_INFINITY)).toBe(false);
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  expect(isJsonValue(cyclic)).toBe(false);
};

describe("isJsonValue", () => {
  test("checks strict JSON without normalizing it", checksStrictJsonWithoutNormalizingIt);
});

const copiesStrictJsonWithoutRetainingAliases = (): void => {
  const shared = { value: 1 };
  const input = { left: shared, right: shared };
  const copied = copyJson(input) as typeof input;
  expect(copied).toEqual(input);
  expect(copied).not.toBe(input);
  expect(copied.left).not.toBe(shared);
  expect(copied.right).not.toBe(shared);
  expect(copied.left).not.toBe(copied.right);
};

const optionallyOmitsUndefinedObjectPropertiesWithout = (): void => {
  const input = { kept: 1, omitted: undefined, nested: { omitted: undefined, kept: true } };
  expect(() => copyJson(input)).toThrow(/strict JSON/u);
  expect(copyJson(input, { omitUndefinedProperties: true })).toEqual({
    kept: 1,
    nested: { kept: true },
  });
  expect(() => copyJson([undefined], { omitUndefinedProperties: true })).toThrow(/strict JSON/u);
};

const preservesNullPrototypesAndOwnProto = (): void => {
  const input = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(input, "__proto__", {
    value: { safe: true },
    enumerable: true,
    writable: true,
    configurable: true,
  });
  const copied = copyJson(input) as Record<string, unknown>;
  expect(Object.getPrototypeOf(copied)).toBeNull();
  expect(Object.hasOwn(copied, "__proto__")).toBe(true);
  expect(copied["__proto__"]).toEqual({ safe: true });
};

const rejectsCyclesAndNonStrictContainer = (): void => {
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  const sparse: unknown[] = [];
  sparse[1] = 1;
  const extra = Object.assign([1], { extra: 2 });
  class ArraySubclass extends Array<unknown> {}
  const subclass = new ArraySubclass(1);
  const accessor = Object.defineProperty({}, "value", { enumerable: true, get: () => 1 });
  const hidden = Object.defineProperty({}, "value", { enumerable: false, value: 1 });
  const symbol = { [Symbol("value")]: 1 };
  for (const invalid of [cyclic, sparse, extra, subclass, accessor, hidden, symbol]) {
    expect(isJsonValue(invalid)).toBe(false);
    expect(() => copyJson(invalid)).toThrow(/strict JSON/u);
  }
};

describe("copyJson", () => {
  test("copies strict JSON without retaining aliases", copiesStrictJsonWithoutRetainingAliases);

  test(
    "optionally omits undefined object properties without normalizing arrays",
    optionallyOmitsUndefinedObjectPropertiesWithout,
  );

  test(
    "preserves null prototypes and own __proto__ data properties",
    preservesNullPrototypesAndOwnProto,
  );

  test("rejects cycles and non-strict container properties", rejectsCyclesAndNonStrictContainer);
});
