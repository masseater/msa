import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { applyImmutable, overlap, track } from "../src/delta/index.ts";

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
