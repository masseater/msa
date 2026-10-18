import { describe, expect, it } from "vite-plus/test";

import { applyImmutable, diffRevisions } from "../src/delta/index.ts";
import type { JsonValue } from "../src/json.ts";
import { expectDiff } from "./fixtures/state-diff.ts";

const keepsFortyThousandRowSparseEdits = (): void => {
  const values = Array.from({ length: 40_000 }, (_, value) => ({ value, stable: { value } }));
  const after = values.slice();
  const changed: number[] = [];
  for (let index = 100; index < after.length; index += 400) {
    after[index] = { value: -index, stable: values[index]!.stable };
    changed.push(index);
  }
  const operations = diffRevisions({ values }, { values: after });
  expect(operations).toEqual(changed.map((index) => ["s", ["values", index, "value"], -index]));
  expect(JSON.stringify(operations).length).toBeLessThan(7_500);
  expect(applyImmutable({ values }, operations)).toEqual({ values: after });
};

const keepsAReconstructedLargeArrayLeaf = (): void => {
  const before = Array.from({ length: 1_000 }, (_, value) => ({ value, label: `row-${value}` }));
  const after = structuredClone(before);
  after[700]!.label = "changed";
  const operations = diffRevisions({ values: before }, { values: after });
  expect(operations).toEqual([["s", ["values", 700, "label"], "changed"]]);
  expect(JSON.stringify(operations).length).toBeLessThan(100);
  expect(applyImmutable({ values: before }, operations)).toEqual({ values: after });
};

const splicesAnAmbiguousEqualCountMoved = (): void => {
  const left = { value: "left" };
  const right = { value: "right" };
  const before = [left, { id: 1, value: "a" }, { id: 2, value: "b" }, right];
  const replacements = [
    { id: 2, value: "edited" },
    { id: 1, value: "also-edited" },
  ];
  const after = [left, ...replacements, right];
  expectDiff({ values: before }, { values: after }, [["p", ["values"], 1, 2, replacements]]);
};

const encodesFiveHundredUnshiftsWithoutSnapshotting = (): void => {
  const retained = Array.from({ length: 10_000 }, (_, value) => ({
    value,
    payload: "x".repeat(100),
  }));
  const inserted = Array.from({ length: 500 }, (_, value) => ({ value: -value - 1 }));
  const operations = diffRevisions({ values: retained }, { values: [...inserted, ...retained] });
  expect(operations).toEqual([["p", ["values"], 0, 0, inserted]]);
  expect(JSON.stringify(operations).length).toBeLessThan(20_000);
  expect(applyImmutable({ values: retained }, operations)).toEqual({
    values: [...inserted, ...retained],
  });
};

const boundsWideObjectOperationEmissionWith = (): void => {
  const before: Record<string, JsonValue> = {};
  const after: Record<string, JsonValue> = {};
  for (let index = 0; index < 20_000; index++) {
    before[`field${index}`] = 0;
    after[`field${index}`] = 1;
  }
  expect(diffRevisions(before, after)).toEqual([["r", after]]);
};

const fallsBackToABaseOperation = (): void => {
  const before = { values: Array.from({ length: 40_000 }, () => 0) };
  const after = { values: Array.from({ length: 40_000 }, () => 1) };
  const operations = diffRevisions(before, after);
  expect(operations).toEqual([["r", after]]);
};

describe("immutable revision diff", () => {
  it.each([1_001, 10_000])("keeps push, pop, and middle removal narrow at %,i items", (size) => {
    const values = Array.from({ length: size }, (_, value) => ({ value }));
    const appended = { value: size };
    expectDiff({ values }, { values: [...values, appended] }, [
      ["p", ["values"], size, 0, [appended]],
    ]);
    expectDiff({ values }, { values: values.slice(0, -1) }, [["p", ["values"], size - 1, 1, []]]);
    const middle = Math.floor(size / 2);
    expectDiff({ values }, { values: [...values.slice(0, middle), ...values.slice(middle + 1)] }, [
      ["p", ["values"], middle, 1, []],
    ]);
  });

  it("keeps forty-thousand-row sparse edits narrow", keepsFortyThousandRowSparseEdits);

  it("keeps a reconstructed large-array leaf edit narrow", keepsAReconstructedLargeArrayLeaf);

  it("splices an ambiguous equal-count moved-and-edited gap", splicesAnAmbiguousEqualCountMoved);

  it(
    "encodes five hundred unshifts without snapshotting retained rows",
    encodesFiveHundredUnshiftsWithoutSnapshotting,
  );

  it(
    "bounds wide-object operation emission with a root replacement",
    boundsWideObjectOperationEmissionWith,
  );

  it("falls back to a base operation when leaf operations are larger", fallsBackToABaseOperation);
});
