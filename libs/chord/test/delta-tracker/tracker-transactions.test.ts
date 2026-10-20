import { describe, expect, it } from "vite-plus/test";

import { track } from "../../src/delta/index.ts";

const keepsAbortedAndStaleMaterializedCandidates = (): void => {
  const tracker = track({ value: 0 });
  const abortedChange = tracker.beginChange();
  abortedChange.state.value = 1;
  const aborted = abortedChange.prepare();
  const abortedView = aborted.value;
  aborted.abort();
  expect(abortedView.value).toBe(1);
  expect(aborted.value.value).toBe(1);

  const loserChange = tracker.beginChange();
  loserChange.state.value = 2;
  const loser = loserChange.prepare();
  const loserView = loser.value;
  const winner = tracker.prepareReplace({ value: 3 });
  tracker.adopt(winner);
  expect(loserView.value).toBe(2);
  expect(loser.value.value).toBe(2);
};

const letsASettledChangeAbortIts = (): void => {
  const tracker = track({ nested: { value: 1 }, value: 0 });
  const change = tracker.beginChange();
  change.state.value = 1;
  const prepared = change.prepare();
  const operations = prepared.ops;
  change.abort();
  change.abort();
  expect(prepared.ops).toBe(operations);
  expect(prepared.value).toEqual({ nested: { value: 1 }, value: 1 });
  expect(() => tracker.adopt(prepared)).toThrow(/aborted/u);
};

const rejectsForeignAndAbortedPreparedValues = (): void => {
  const first = track({ value: 0 });
  const second = track({ value: 0 });
  const prepared = first.prepareReplace({ value: 1 });
  expect(() => second.adopt(prepared)).toThrow(/different tracker/u);
  prepared.abort();
  prepared.abort();
  expect(() => first.adopt(prepared)).toThrow(/aborted/u);
};

type Inheriting = { value?: number; trackerInherited?: number };

const readsDeletedOwnPropertiesAsAbsent = (): void => {
  const initial = Object.create(
    Object.create(Object.prototype, {
      trackerInherited: { configurable: true, value: 7, writable: true },
    }),
  ) as Inheriting;
  initial.value = 1;
  const tracker = track(initial);
  const change = tracker.beginChange();
  delete change.state.value;
  change.state.trackerInherited = 1;
  delete change.state.trackerInherited;
  expect(change.state.value).toBeUndefined();
  expect(change.state.trackerInherited).toBeUndefined();
  const prepared = change.prepare();
  expect(prepared.value.value).toBeUndefined();
  expect(prepared.value.trackerInherited).toBe(7);
  tracker.adopt(prepared);
  expect(Object.keys(tracker.value)).toEqual([]);
};

const detachesOldHandlesForDeeplyEqual = (): void => {
  const initial = {
    array: [{ value: 1 }],
    object: { nested: { value: 1 } },
    rows: [{ value: 1 }],
  };
  const tracker = track(initial);
  const change = tracker.beginChange();
  const oldObject = change.state.object;
  const oldArray = change.state.array;
  const oldRow = change.state.rows[0]!;
  change.state.object = { nested: { value: 1 } };
  change.state.array = [{ value: 1 }];
  change.state.rows[0] = { value: 1 };
  expect(change.state.object).not.toBe(oldObject);
  expect(change.state.array).not.toBe(oldArray);
  expect(change.state.rows[0]).not.toBe(oldRow);
  oldObject.nested.value = 9;
  oldArray[0]!.value = 9;
  oldRow.value = 9;
  expect(change.state).toEqual({
    array: [{ value: 1 }],
    object: { nested: { value: 1 } },
    rows: [{ value: 1 }],
  });
  const prepared = change.prepare();
  expect(prepared.ops).toEqual([]);
  tracker.adopt(prepared);
  expect(tracker.value).toBe(initial);
  expect(tracker.value.object).toBe(initial.object);
  expect(tracker.value.array).toBe(initial.array);
  expect(tracker.value.rows[0]).toBe(initial.rows[0]);
};

const normalizesADeeplyEqualReplacementWithout = (): void => {
  const initial = { nested: { value: 1 }, rows: [1, 2, 3] };
  const tracker = track(initial);
  const prepared = tracker.prepareReplace({ nested: { value: 1 }, rows: [1, 2, 3] });
  expect(prepared.ops).toEqual([]);
  tracker.adopt(prepared);
  expect(tracker.value).toBe(initial);
};

const takesO1ImmutableOwnershipFor = (): void => {
  const tracker = track({ rows: [] as { value: number }[], value: 0 });
  const replacement = { rows: [{ value: 2 }], value: 1 };
  const prepared = tracker.prepareReplace(replacement);
  expect(prepared.base).toBe(tracker.value);
  expect(prepared.value).toBe(replacement);
  const operations = prepared.ops;
  expect(operations).toEqual([["r", replacement]]);
  expect((operations[0] as readonly ["r", typeof replacement])[1]).toBe(replacement);
  tracker.adopt(prepared);
  expect(tracker.value).toBe(replacement);
};

describe("delta tracker transactional overlay lifecycle", () => {
  it(
    "keeps aborted and stale materialized candidates readable",
    keepsAbortedAndStaleMaterializedCandidates,
  );

  it(
    "lets a settled Change abort its prepared result without retaining its context",
    letsASettledChangeAbortIts,
  );

  it("rejects foreign and aborted prepared values", rejectsForeignAndAbortedPreparedValues);

  it("reads deleted own properties as absent", readsDeletedOwnPropertiesAsAbsent);

  it(
    "detaches old handles for deeply equal object and array assignments before normalizing",
    detachesOldHandlesForDeeplyEqual,
  );

  it(
    "normalizes a deeply equal replacement without changing committed identity",
    normalizesADeeplyEqualReplacementWithout,
  );

  it(
    "takes O(1) immutable ownership for replacement and its operation payload",
    takesO1ImmutableOwnershipFor,
  );
});
