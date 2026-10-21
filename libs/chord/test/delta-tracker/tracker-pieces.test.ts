import { describe, expect, it } from "vite-plus/test";

import delta from "../../src/delta/index.ts";
import trackerModule from "../fixtures/tracker.ts";

const { track } = delta;

const { clone, replay, settle } = trackerModule;

const emitsOneInsertForAnAppend = (): void => {
  const tracker = track({ values: Array.from({ length: 10_000 }, (_, index) => index) });
  const change = tracker.beginChange();
  change.state.values.push(-1);
  const prepared = change.prepare();
  expect(prepared.ops).toEqual([["p", ["values"], 10_000, 0, [-1]]]);
  tracker.adopt(prepared);
  expect(tracker.value.values.at(-1)).toBe(-1);
  expect(tracker.value.values).toHaveLength(10_001);
};

const emitsRemovalsFromTheEndBackwards = (): void => {
  const tracker = track({ values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] });
  const values = settle(tracker, (draft) => {
    draft.values.shift();
    draft.values.splice(1, 2, 20);
    draft.values.splice(5, 1);
    draft.values.pop();
    draft.values.push(30);
  });
  expect(values.values).toEqual([1, 20, 4, 5, 6, 8, 30]);
  const change = track({ values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }).beginChange();
  change.state.values.shift();
  change.state.values.splice(1, 2, 20);
  change.state.values.splice(5, 1);
  change.state.values.pop();
  change.state.values.push(30);
  expect(change.prepare().ops).toEqual([
    ["p", ["values"], 9, 1, []],
    ["p", ["values"], 7, 1, []],
    ["p", ["values"], 2, 2, []],
    ["p", ["values"], 0, 1, []],
    ["p", ["values"], 1, 0, [20]],
    ["p", ["values"], 6, 0, [30]],
  ]);
};

const emitsAPermutationWhenKeptElements = (): void => {
  for (const mutate of [
    (values: number[]) => values.reverse(),
    (values: number[]) => values.sort((left, right) => (left % 2) - (right % 2) || left - right),
  ]) {
    const tracker = track({ values: [0, 1, 2, 3, 4] });
    const expected = [0, 1, 2, 3, 4];
    mutate(expected);
    const change = tracker.beginChange();
    mutate(change.state.values);
    const prepared = change.prepare();
    expect(prepared.ops.some((operation) => operation[0] === "m")).toBe(true);
    expect(replay(tracker.value, prepared.ops)).toEqual({ values: expected });
  }
};

const keepsAdoptionIndependentFromMutableDetached = (): void => {
  const tracker = track({ values: [3, 1, 2] });
  const change = tracker.beginChange();
  change.state.values.sort((left, right) => left - right);
  const prepared = change.prepare();
  const permutation = prepared.ops.find((operation) => operation[0] === "m");
  if (permutation?.[0] !== "m") throw new Error("expected permutation");
  permutation[2].reverse();
  tracker.adopt(prepared);
  expect(tracker.value.values).toEqual([1, 2, 3]);
};

const matchesNativeSpliceWithZeroOr = (): void => {
  const noArguments = track({ values: [1, 2, 3] });
  const noArgumentsChange = noArguments.beginChange();
  expect(
    Reflect.apply(noArgumentsChange.state.values.splice, noArgumentsChange.state.values, []),
  ).toEqual([]);
  const noArgumentsPrepared = noArgumentsChange.prepare();
  expect(noArgumentsPrepared.value.values).toEqual([1, 2, 3]);
  expect(noArgumentsPrepared.ops).toEqual([]);
  noArguments.adopt(noArgumentsPrepared);

  const oneArgument = track({ values: [1, 2, 3, 4] });
  const oneArgumentChange = oneArgument.beginChange();
  expect(oneArgumentChange.state.values.splice(1)).toEqual([2, 3, 4]);
  const oneArgumentPrepared = oneArgumentChange.prepare();
  expect(oneArgumentPrepared.value.values).toEqual([1]);
  expect(replay(oneArgument.value, oneArgumentPrepared.ops)).toEqual(oneArgumentPrepared.value);
  oneArgument.adopt(oneArgumentPrepared);

  const pastEnd = track({ values: [1, 2, 3] });
  const pastEndChange = pastEnd.beginChange();
  expect(pastEndChange.state.values.splice(3)).toEqual([]);
  const pastEndPrepared = pastEndChange.prepare();
  expect(pastEndPrepared.value.values).toEqual([1, 2, 3]);
  pastEnd.adopt(pastEndPrepared);
};

const supportsAllStructuralMutatorsAndNative = (): void => {
  const tracker = track({ values: [3, 1, 2] });
  const base = clone(tracker.value);
  const change = tracker.beginChange();
  expect(change.state.values.push(4)).toBe(4);
  expect(change.state.values.pop()).toBe(4);
  expect(change.state.values.unshift(0)).toBe(4);
  expect(change.state.values.shift()).toBe(0);
  expect(change.state.values.splice(1, 1, 5, 4)).toEqual([1]);
  expect(change.state.values.sort((left, right) => left - right)).toBe(change.state.values);
  expect(change.state.values.reverse()).toBe(change.state.values);
  change.state.values.fill(9, 1, 3);
  change.state.values.copyWithin(1, 0, 2);
  const prepared = change.prepare();
  expect(prepared.value).toEqual({ values: [5, 5, 9, 2] });
  expect(replay(base, prepared.ops)).toEqual(prepared.value);
  tracker.adopt(prepared);
};

const tracksHeldHandlesAfterReindexAnd = (): void => {
  const tracker = track({ values: [{ value: "a" }, { value: "b" }, { value: "c" }] });
  const change = tracker.beginChange();
  const held = change.state.values[1]!;
  change.state.values.unshift({ value: "front" });
  held.value = "moved";
  expect(change.state.values[2]!.value).toBe("moved");
  change.state.values.splice(2, 1);
  held.value = "detached";
  const prepared = change.prepare();
  expect(prepared.value).toEqual({
    values: [{ value: "front" }, { value: "a" }, { value: "c" }],
  });
  expect(replay(tracker.value, prepared.ops)).toEqual(prepared.value);
  tracker.adopt(prepared);
};

const replaysIntroducedMovedThenEditedArray = (): void => {
  const tracker = track({ values: [] as { id: number; nested: number[] }[] });
  const base = clone(tracker.value);
  const change = tracker.beginChange();
  change.state.values.push({ id: 1, nested: [1] });
  const held = change.state.values[0]!;
  change.state.values.unshift({ id: 0, nested: [] });
  held.nested.push(2);
  change.state.values.reverse();
  held.nested.push(3);
  const prepared = change.prepare();
  expect(prepared.value).toEqual({
    values: [
      { id: 1, nested: [1, 2, 3] },
      { id: 0, nested: [] },
    ],
  });
  expect(replay(base, prepared.ops)).toEqual(prepared.value);
  tracker.adopt(prepared);
};

const combinesMovementAndEditsWithPermutation = (): void => {
  const tracker = track({
    values: [
      { edited: 0, rank: 3 },
      { edited: 0, rank: 1 },
      { edited: 0, rank: 2 },
    ],
  });
  const base = clone(tracker.value);
  const change = tracker.beginChange();
  const held = change.state.values[0]!;
  change.state.values.sort((left, right) => left.rank - right.rank);
  held.edited = 1;
  const prepared = change.prepare();
  expect(prepared.ops[0]).toEqual(["m", ["values"], [1, 2, 0]]);
  expect(replay(base, prepared.ops)).toEqual(prepared.value);
  tracker.adopt(prepared);
};

const keepsComparatorWritesAndStructurallyReentrant = (): void => {
  const tracker = track({
    values: [
      { comparisons: 0, rank: 2 },
      { comparisons: 0, rank: 1 },
    ],
  });
  const base = clone(tracker.value);
  const change = tracker.beginChange();
  let appended = false;
  change.state.values.sort((left, right) => {
    left.comparisons++;
    right.comparisons++;
    if (!appended) {
      appended = true;
      change.state.values[0] = { comparisons: 0, rank: 9 };
      change.state.values.push({ comparisons: 0, rank: 3 });
    }
    return left.rank - right.rank;
  });
  const prepared = change.prepare();
  expect(prepared.value.values.map((value) => value.rank)).toEqual([1, 2, 3]);
  expect(prepared.value.values.map((value) => value.comparisons)).toEqual([1, 1, 0]);
  expect(replay(base, prepared.ops)).toEqual(prepared.value);
  tracker.adopt(prepared);
};

describe("delta tracker piece arrays", () => {
  it("emits one insert for an append to a long array", emitsOneInsertForAnAppend);

  it(
    "emits removals from the end backwards, then inserts, when kept elements keep their order",
    emitsRemovalsFromTheEndBackwards,
  );

  it("emits a permutation when kept elements change order", emitsAPermutationWhenKeptElements);

  it(
    "keeps adoption independent from mutable detached permutation metadata",
    keepsAdoptionIndependentFromMutableDetached,
  );

  it("matches native splice with zero or one argument", matchesNativeSpliceWithZeroOr);

  it(
    "supports all structural mutators and native return values",
    supportsAllStructuralMutatorsAndNative,
  );

  it(
    "tracks held handles after reindex and suppresses detached writes",
    tracksHeldHandlesAfterReindexAnd,
  );

  it(
    "replays introduced, moved, then edited array descendants",
    replaysIntroducedMovedThenEditedArray,
  );

  it(
    "combines movement and edits with permutation plus final paths",
    combinesMovementAndEditsWithPermutation,
  );

  it(
    "keeps comparator writes and structurally reentrant appends",
    keepsComparatorWritesAndStructurallyReentrant,
  );
});
