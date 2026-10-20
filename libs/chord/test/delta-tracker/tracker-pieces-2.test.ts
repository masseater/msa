import { describe, expect, it } from "vite-plus/test";

import delta from "../../src/delta/index.ts";
import trackerModule from "../fixtures/tracker.ts";

const { track } = delta;

const { clone, expectAliasFree, replay } = trackerModule;

const normalizesDuplicateEntriesCreatedByStructurally = (): void => {
  const tracker = track({
    values: [
      { edited: 0, nested: { value: 0 }, rank: 2 },
      { edited: 0, nested: { value: 0 }, rank: 1 },
    ],
  });
  const base = clone(tracker.value);
  const change = tracker.beginChange();
  let inserted = false;
  change.state.values.sort((left, right) => {
    left.edited = left.rank * 10;
    left.nested.value = left.rank * 100;
    right.edited = right.rank * 10;
    right.nested.value = right.rank * 100;
    if (!inserted) {
      inserted = true;
      change.state.values.unshift({ edited: 0, nested: { value: 0 }, rank: 4 });
    }
    return left.rank - right.rank;
  });
  const prepared = change.prepare();
  expect(prepared.value.values.map((value) => value.rank)).toEqual([1, 2, 1]);
  expect(prepared.value.values.map((value) => value.edited)).toEqual([10, 20, 10]);
  expect(prepared.value.values.map((value) => value.nested.value)).toEqual([100, 200, 100]);
  expect(prepared.value.values[0]).not.toBe(prepared.value.values[2]);
  expect(prepared.value.values[0]!.nested).not.toBe(prepared.value.values[2]!.nested);
  expect(replay(base, prepared.ops)).toEqual(prepared.value);
  expectAliasFree(prepared.value);
  tracker.adopt(prepared);
};

const foldsDenseChildAndDirectIndex = (): void => {
  const rowsTracker = track({ rows: Array.from({ length: 1_000 }, (_, value) => ({ value })) });
  const rowsBase = clone(rowsTracker.value);
  const rowsChange = rowsTracker.beginChange();
  for (const row of rowsChange.state.rows) row.value += 1;
  const rowsPrepared = rowsChange.prepare();
  expect(rowsPrepared.ops).toHaveLength(1);
  expect(rowsPrepared.ops[0]?.[0]).toBe("p");
  expect(replay(rowsBase, rowsPrepared.ops)).toEqual(rowsPrepared.value);
  rowsTracker.adopt(rowsPrepared);

  const valuesTracker = track({ values: Array.from({ length: 1_000 }, (_, value) => value) });
  const valuesBase = clone(valuesTracker.value);
  const valuesChange = valuesTracker.beginChange();
  for (let index = 0; index < 600; index++) valuesChange.state.values[index] = -index - 1;
  const valuesPrepared = valuesChange.prepare();
  expect(valuesPrepared.ops).toHaveLength(1);
  expect(valuesPrepared.ops[0]?.[0]).toBe("p");
  expect(replay(valuesBase, valuesPrepared.ops)).toEqual(valuesPrepared.value);
  valuesTracker.adopt(valuesPrepared);
};

const foldsOnlyADeeplyNestedDense = (): void => {
  const tracker = track({
    rows: Array.from({ length: 2_000 }, (_, value) => ({ nested: { value } })),
  });
  const base = clone(tracker.value);
  const change = tracker.beginChange();
  change.state.rows[0]!.nested.value = -1;
  for (let index = 500; index < 1_000; index++) change.state.rows[index]!.nested.value = -index;
  const prepared = change.prepare();
  const splice = prepared.ops.find((operation) => operation[0] === "p");
  expect(splice?.slice(0, 4)).toEqual(["p", ["rows"], 500, 500]);
  if (splice?.[0] !== "p") throw new Error("expected regional splice");
  expect(splice[4]).toHaveLength(500);
  expect(prepared.ops).toHaveLength(2);
  expect(replay(base, prepared.ops)).toEqual(prepared.value);
  tracker.adopt(prepared);
};

const doesNotCacheEmissionPathsFor = (): void => {
  type Row = { flag: number; special?: { __proto__: { values: number[] } } };
  const rows: Row[] = Array.from({ length: 400 }, () => ({ flag: 0 }));
  rows[100]!.special = JSON.parse(
    `{"__proto__":{"values":[${Array.from({ length: 400 }, (_, value) => value).join(",")}]}}`,
  ) as NonNullable<Row["special"]>;
  const tracker = track({ rows });
  const base = clone(tracker.value);
  const change = tracker.beginChange();
  for (let index = 0; index < 256; index++) change.state.rows[index]!.flag = 1;
  for (let index = 0; index < 256; index++) {
    change.state.rows[100]!.special!.__proto__.values[index] = -index - 1;
  }
  const prepared = change.prepare();
  expect(prepared.ops).toHaveLength(1);
  expect(prepared.ops[0]?.slice(0, 4)).toEqual(["p", ["rows"], 0, 256]);
  expect(replay(base, prepared.ops)).toEqual(prepared.value);
  tracker.adopt(prepared);
};

const suppressesNestedStructuralAndLeafOperations = (): void => {
  const tracker = track({
    rows: Array.from({ length: 400 }, (_, index) => ({
      flag: 0,
      values: index === 100 ? Array.from({ length: 400 }, (_cell, value) => ({ value })) : [],
    })),
  });
  const base = clone(tracker.value);
  const change = tracker.beginChange();
  for (let index = 0; index < 256; index++) change.state.rows[index]!.flag = 1;
  for (let index = 0; index < 256; index++)
    change.state.rows[100]!.values[index]!.value = -index - 1;
  change.state.rows[100]!.values.push({ value: 999 });
  const prepared = change.prepare();
  expect(prepared.ops).toHaveLength(1);
  expect(prepared.ops[0]?.slice(0, 4)).toEqual(["p", ["rows"], 0, 256]);
  expect(prepared.value.rows[100]!.values).toHaveLength(401);
  expect(replay(base, prepared.ops)).toEqual(prepared.value);
  tracker.adopt(prepared);
};

const emitsMultipleDisjointDenseRegionsAnd = (): void => {
  const tracker = track({ values: Array.from({ length: 1_400 }, (_, value) => ({ value })) });
  const base = clone(tracker.value);
  const change = tracker.beginChange();
  for (const index of [97, 358, 897, 1_158]) change.state.values[index]!.value = -index - 1;
  for (let index = 100; index < 356; index++) change.state.values[index]!.value = -index - 1;
  for (let index = 900; index < 1_156; index++) change.state.values[index]!.value = -index - 1;
  const prepared = change.prepare();
  const splices = prepared.ops.filter((operation) => operation[0] === "p");
  expect(splices.map((operation) => operation.slice(0, 4))).toEqual([
    ["p", ["values"], 100, 256],
    ["p", ["values"], 900, 256],
  ]);
  for (const index of [97, 358, 897, 1_158]) {
    expect(prepared.ops).toContainEqual(["s", ["values", index, "value"], -index - 1]);
  }
  expect(prepared.ops).toHaveLength(6);
  expect(replay(base, prepared.ops)).toEqual(prepared.value);
  tracker.adopt(prepared);
};

const normalizesA20000OperationQueue = (): void => {
  const tracker = track({ values: Array.from({ length: 20_000 }, (_, value) => ({ value })) });
  const base = clone(tracker.value);
  const change = tracker.beginChange();
  for (let index = 0; index < 10_000; index++) {
    change.state.values.shift();
    change.state.values.push({ value: 20_000 + index });
  }
  const prepared = change.prepare();
  expect(prepared.ops).toHaveLength(2);
  expect(replay(base, prepared.ops)).toEqual(prepared.value);
  tracker.adopt(prepared);
};

const handlesAdversarialFragmentationAndResolvesHeld = (): void => {
  const size = 20_000;
  const tracker = track({ values: Array.from({ length: size }, (_, value) => ({ value })) });
  const expected = clone(tracker.value);
  const base = clone(tracker.value);
  const change = tracker.beginChange();
  const held = [1, 1_001, 5_001, 10_001, 15_001, 19_999].map(
    (index) => change.state.values[index]!,
  );
  for (let index = 0; index < size; index += 2) {
    change.state.values.splice(index, 1, { value: -index - 1 });
    expected.values.splice(index, 1, { value: -index - 1 });
  }
  for (const value of held) value.value += 100_000;
  for (const index of [1, 1_001, 5_001, 10_001, 15_001, 19_999])
    expected.values[index]!.value += 100_000;
  const prepared = change.prepare();
  expect(prepared.value).toEqual(expected);
  expect(replay(base, prepared.ops)).toEqual(prepared.value);
  tracker.adopt(prepared);
};

const normalizesRestoredOverridesAndCancelledStructural = (): void => {
  const tracker = track({ values: [1, 2, 3] });
  const change = tracker.beginChange();
  change.state.values[1] = 9;
  change.state.values[1] = 2;
  change.state.values.reverse();
  change.state.values.reverse();
  change.state.values.push(4);
  expect(change.state.values.pop()).toBe(4);
  const prepared = change.prepare();
  expect(prepared.value).toEqual({ values: [1, 2, 3] });
  expect(prepared.ops).toEqual([]);
  tracker.adopt(prepared);
};

describe("delta tracker piece arrays", () => {
  it(
    "normalizes duplicate entries created by structurally reentrant sort callbacks",
    normalizesDuplicateEntriesCreatedByStructurally,
  );

  it(
    "folds dense child and direct-index edits into one full-array operation",
    foldsDenseChildAndDirectIndex,
  );

  it("folds only a deeply nested dense array region", foldsOnlyADeeplyNestedDense);

  it(
    "does not cache emission paths for nested reserved-key folds covered by an outer region",
    doesNotCacheEmissionPathsFor,
  );

  it(
    "suppresses nested structural and leaf operations covered by an outer dense region",
    suppressesNestedStructuralAndLeafOperations,
  );

  it(
    "emits multiple disjoint dense regions and preserves operations outside their boundaries",
    emitsMultipleDisjointDenseRegionsAnd,
  );

  it(
    "normalizes a 20,000-operation queue transaction to two operations",
    normalizesA20000OperationQueue,
  );

  it(
    "handles adversarial fragmentation and resolves held handles without piece scans",
    handlesAdversarialFragmentationAndResolvesHeld,
    30_000,
  );

  it(
    "normalizes restored overrides and cancelled structural edits to no operations",
    normalizesRestoredOverridesAndCancelledStructural,
  );
});
