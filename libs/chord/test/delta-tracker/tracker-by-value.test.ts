import { DateTime } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { type Change, type JsonValue, track } from "../../src/delta/index.ts";
import trackerModule from "../fixtures/tracker.ts";

const { clone, expectAliasFree, replay } = trackerModule;

const clonesPropertyIndexPushUnshiftSplice = (): void => {
  const tracker = track({
    property: null as { value: number } | null,
    values: [{ value: 0 }, { value: 1 }, { value: 2 }],
  });
  const external = { value: 5 };
  const change = tracker.beginChange();
  change.state.property = external;
  change.state.values[0] = external;
  change.state.values.push(external);
  change.state.values.unshift(external);
  change.state.values.splice(2, 0, external);
  external.value = 99;
  change.state.values.fill(change.state.values[0]!, 1, 3);
  change.state.values.copyWithin(3, 0, 2);
  const prepared = change.prepare();
  const candidate = clone(prepared.value);
  expect(candidate.property).toEqual({ value: 5 });
  expect(candidate.values.slice(0, 5)).toEqual([
    { value: 5 },
    { value: 5 },
    { value: 5 },
    { value: 5 },
    { value: 5 },
  ]);
  tracker.adopt(prepared);
};

const rejectsNonPlainContainers = (change: Change<Placements>): void => {
  const sparse: JsonValue[] = new Array<JsonValue>(1);
  expect(() => {
    change.state.payload = sparse;
  }).toThrow(/dense plain arrays/u);
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  expect(() => {
    change.state.payload = cyclic as JsonValue;
  }).toThrow(/cycles/u);
  let accessorReads = 0;
  const accessor = Object.defineProperty({}, "value", {
    enumerable: true,
    get() {
      accessorReads += 1;
      return 1;
    },
  });
  expect(() => {
    change.state.payload = accessor as JsonValue;
  }).toThrow(/data properties/u);
  expect(accessorReads).toBe(0);
};

interface Placements {
  optional: string | undefined;
  payload: JsonValue;
  number: number;
  values: JsonValue[];
}

const rejectsNonJsonScalars = (change: Change<Placements>): void => {
  const undefinedValue = undefined as unknown as JsonValue;

  expect(() => {
    change.state.values[0] = undefinedValue;
  }).toThrow(/strict JSON/u);
  expect(() => change.state.values.push({ staged: true }, undefinedValue)).toThrow(/strict JSON/u);
  expect(() => change.state.values.unshift(undefinedValue)).toThrow(/strict JSON/u);
  expect(() => change.state.values.splice(1, 0, undefinedValue)).toThrow(/strict JSON/u);
  expect(() => change.state.values.fill(undefinedValue)).toThrow(/strict JSON/u);
  expect(() => {
    change.state.payload = { nested: undefined } as unknown as JsonValue;
  }).toThrow(/strict JSON/u);
  expect(() => {
    change.state.payload = { nested: () => 1 } as unknown as JsonValue;
  }).toThrow(/strict JSON/u);
  expect(() => {
    change.state.payload = { nested: Symbol("invalid") } as unknown as JsonValue;
  }).toThrow(/strict JSON/u);
  expect(() => {
    change.state.payload = { nested: 1n } as unknown as JsonValue;
  }).toThrow(/strict JSON/u);
  expect(() => {
    change.state.number = Number.NaN;
  }).toThrow(/strict JSON/u);
  expect(() => {
    change.state.number = Number.POSITIVE_INFINITY;
  }).toThrow(/strict JSON/u);
  expect(() => {
    change.state.payload = DateTime.toDateUtc(DateTime.nowUnsafe()) as unknown as JsonValue;
  }).toThrow(/plain objects/u);
};

const rejectsNonStrictJsonPlacementsBefore = (): void => {
  const initial: Placements = { number: 0, optional: "remove", payload: null, values: [1, 2] };
  const tracker = track(initial);
  const change = tracker.beginChange();
  rejectsNonJsonScalars(change);

  rejectsNonPlainContainers(change);

  expect(change.state).toEqual(initial);
  change.state.optional = undefined;
  const dictionary = Object.create(null) as Record<string, JsonValue>;
  dictionary["valid"] = true;
  change.state.payload = dictionary;
  change.state.values.push({ valid: true });
  const prepared = change.prepare();
  expect(prepared.value).toEqual({
    number: 0,
    payload: { valid: true },
    values: [1, 2, { valid: true }],
  });
  expect(Object.getPrototypeOf(prepared.value.payload)).toBeNull();
  expect(replay(initial, prepared.ops)).toEqual(prepared.value);
  tracker.adopt(prepared);
};

const expandsRepeatedSourceAliasesIntoIndependent = (): void => {
  const tracker = track({
    left: null as { nested: { value: number } } | null,
    right: null as { nested: { value: number } } | null,
    rows: [] as { nested: { value: number } }[],
  });
  const shared = { nested: { value: 1 } };
  const change = tracker.beginChange();
  change.state.left = shared;
  change.state.right = shared;
  change.state.rows.push(shared, shared);
  change.state.left.nested.value = 9;
  change.state.rows[0]!.nested.value = 8;
  const prepared = change.prepare();
  expect(prepared.value).toEqual({
    left: { nested: { value: 9 } },
    right: { nested: { value: 1 } },
    rows: [{ nested: { value: 8 } }, { nested: { value: 1 } }],
  });
  expect(prepared.value.left).not.toBe(prepared.value.right);
  expect(prepared.value.rows[0]).not.toBe(prepared.value.rows[1]);
  expect(replay(tracker.value, prepared.ops)).toEqual(prepared.value);
  tracker.adopt(prepared);
};

const deepClonesDraftSourcedPlacementsWithin = (): void => {
  const tracker = track({
    a: { child: { value: 1 } },
    b: null as { child: { value: number } } | null,
    rows: [{ child: { value: 1 } }, { child: { value: 2 } }],
  });
  const first = tracker.beginChange();
  first.state.b = first.state.a;
  first.state.b.child.value = 3;
  first.state.rows[1] = first.state.rows[0]!;
  const firstPrepared = first.prepare();
  expect(firstPrepared.value.a.child.value).toBe(1);
  expect(firstPrepared.value.b?.child.value).toBe(3);
  expect(firstPrepared.value.a).not.toBe(firstPrepared.value.b);
  expect(firstPrepared.value.a.child).not.toBe(firstPrepared.value.b?.child);
  expect(firstPrepared.value.rows[0]).not.toBe(firstPrepared.value.rows[1]);
  expect(firstPrepared.value.rows[0]!.child).not.toBe(firstPrepared.value.rows[1]!.child);
  expectAliasFree(firstPrepared.value);
  tracker.adopt(firstPrepared);

  const base = clone(tracker.value);
  const second = tracker.beginChange();
  second.state.rows[1]!.child.value = 4;
  const secondPrepared = second.prepare();
  expect(secondPrepared.value.rows.map((row) => row.child.value)).toEqual([1, 4]);
  expect(replay(base, secondPrepared.ops)).toEqual(secondPrepared.value);
  expectAliasFree(secondPrepared.value);
  tracker.adopt(secondPrepared);
};

const distinguishesRawCommittedReferencesFromDraft = (): void => {
  const tracker = track({
    draftCopy: null as { value: number } | null,
    rawCopy: null as { value: number } | null,
    source: { value: 1 },
  });
  const raw = tracker.value.source;
  const change = tracker.beginChange();
  change.state.source.value = 2;
  change.state.rawCopy = raw;
  change.state.draftCopy = change.state.source;
  const prepared = change.prepare();
  expect(prepared.value).toEqual({
    draftCopy: { value: 2 },
    rawCopy: { value: 1 },
    source: { value: 2 },
  });
  tracker.adopt(prepared);
};

const foldsEditsToIntroducedObjectAnd = (): void => {
  const tracker = track({
    nested: null as { rows: { value: number }[] } | null,
    rows: [] as { values: number[] }[],
  });
  const change = tracker.beginChange();
  change.state.nested = { rows: [{ value: 1 }] };
  change.state.nested.rows[0]!.value = 2;
  change.state.nested.rows.push({ value: 3 });
  change.state.rows.push({ values: [1] });
  change.state.rows[0]!.values.push(2);
  const prepared = change.prepare();
  expect(prepared.ops).toEqual([
    ["s", ["nested"], { rows: [{ value: 2 }, { value: 3 }] }],
    ["p", ["rows"], 0, 0, [{ values: [1, 2] }]],
  ]);
  expect(replay(tracker.value, prepared.ops)).toEqual(prepared.value);
  tracker.adopt(prepared);
};

describe("delta tracker by-value placements", () => {
  it(
    "clones property, index, push, unshift, splice, fill, and copyWithin placements",
    clonesPropertyIndexPushUnshiftSplice,
  );

  it(
    "rejects non-strict JSON placements before changing the draft",
    rejectsNonStrictJsonPlacementsBefore,
  );

  it(
    "expands repeated source aliases into independent placements",
    expandsRepeatedSourceAliasesIntoIndependent,
  );

  it(
    "deep-clones draft-sourced placements within and across revisions",
    deepClonesDraftSourcedPlacementsWithin,
  );

  it(
    "distinguishes raw committed references from draft references",
    distinguishesRawCommittedReferencesFromDraft,
  );

  it(
    "folds edits to introduced object and array subtrees into placement payloads",
    foldsEditsToIntroducedObjectAnd,
  );
});
