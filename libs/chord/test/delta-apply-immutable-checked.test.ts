import { describe, expect, it } from "vite-plus/test";

import {
  type JsonValue,
  type Op,
  PathError,
  UnsafePathError,
  applyImmutable,
} from "../src/delta/index.ts";
import deltaApplyImmutable from "./fixtures/delta-apply-immutable.ts";

const { freezeDeep } = deltaApplyImmutable;

const allowsOneImmutableBatchToFan = (): void => {
  const payload = freezeDeep({ nested: { value: 1 } });
  const operations: readonly Op[] = [
    ["s", ["placed"], payload],
    ["s", ["placed", "nested", "value"], 2],
  ];
  const base = freezeDeep({ placed: null as typeof payload | null });
  const first = applyImmutable(base, operations);
  const second = applyImmutable(base, operations);
  expect(first).toEqual(second);
  expect(first).not.toBe(second);
  expect(first.placed).not.toBe(second.placed);
  expect(payload.nested.value).toBe(1);
};

describe("checked immutable operation application", () => {
  it(
    "allows one immutable batch to fan out without mutating shared payloads",
    allowsOneImmutableBatchToFan,
  );
});

const appendsToAnArrayNotYet = (): void => {
  const entries = Array.from({ length: 1_000 }, (_, index) => ({ index }));
  const base = freezeDeep({ log: { entries, meta: { count: 1_000 } }, other: { value: 1 } });
  const result = applyImmutable(base, [
    ["p", ["log", "entries"], 1_000, 0, [{ index: 1_000 }]],
    ["p", ["log", "entries"], 1_001, 0, [{ index: 1_001 }]],
  ]);
  expect(result.log.entries).toHaveLength(1_002);
  expect(result.log.entries.slice(-2)).toEqual([{ index: 1_000 }, { index: 1_001 }]);
  expect(base.log.entries).toHaveLength(1_000);
  expect(result.log.entries[0]).toBe(entries[0]);
  expect(result.log.meta).toBe(base.log.meta);
  expect(result.other).toBe(base.other);
  expect(result.log).not.toBe(base.log);

  const rootArray = freezeDeep([1, 2]);
  expect(applyImmutable(rootArray, [["p", [], 2, 0, [3]]])).toEqual([1, 2, 3]);
  expect(rootArray).toEqual([1, 2]);
  expect(applyImmutable(rootArray, [["p", [], 2, 0, [[3, 4]]]])).toEqual([1, 2, [3, 4]]);
  const invalid: [Op, typeof PathError | typeof UnsafePathError][] = [
    [["p", ["values", "missing"], 0, 0, []], PathError],
    [["p", ["missing"], 0, 0, []], PathError],
    [["p", ["values", 0], 0, 0, []], PathError],
    [["p", ["__proto__"], 0, 0, []], UnsafePathError],
    [["p", ["list", "x"], 0, 0, []], PathError],
    [["p", ["text"], 0, 0, []], PathError],
    [["p", ["list", -1], 0, 0, []], UnsafePathError],
    [["p", ["list", 1.5], 0, 0, []], UnsafePathError],
    [["p", ["list", 0, "constructor"], 0, 0, []], UnsafePathError],
  ];
  const document = freezeDeep({ list: [[1]], text: "a", values: [] as JsonValue[] });
  for (const [op, error] of invalid)
    expect(() => applyImmutable(document, [op]), JSON.stringify(op)).toThrow(error);
  expect(applyImmutable(rootArray, [["p", [], 1, 0, [9]]])).toEqual([1, 9, 2]);
};

const copiesAWideObjectOnceRather = (): void => {
  const width = 20_000;
  const base: Record<string, JsonValue> = {};
  for (let index = 0; index < width; index++) base[`field${index}`] = index;
  const operations: Op[] = Array.from({ length: 1_000 }, (_, index): Op => [
    "s",
    [`field${index}`],
    -index,
  ]);
  const originalKeys = Object.keys;
  let shallowCopies = 0;
  Object.keys = ((value: object): string[] => {
    shallowCopies++;
    return originalKeys(value);
  }) as typeof Object.keys;
  let result: Record<string, JsonValue>;
  try {
    result = applyImmutable(base, operations);
  } finally {
    Object.keys = originalKeys;
  }

  expect(result["field999"]).toBe(-999);
  expect(base["field999"]).toBe(999);
  expect(shallowCopies).toBe(1);
};

describe("immutable application complexity", () => {
  it(
    "appends to an array not yet copied in one copy, sharing everything else",
    appendsToAnArrayNotYet,
  );

  it("copies a wide object once rather than once per repeated write", copiesAWideObjectOnceRather);
});
