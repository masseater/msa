import { describe, expect, it } from "vite-plus/test";

import { decoder, encoder, track } from "../../src/delta/index.ts";
import { clone, replay, settle } from "../fixtures/tracker.ts";

const supportsNativeReadsDescriptorsKeysIteration = (): void => {
  const tracker = track({ values: [1, 2, 3], object: { a: 1 } as { a: number; b?: number } });
  const change = tracker.beginChange();
  change.state.values.splice(1, 1, 4, 5);
  change.state.object.b = 2;
  expect(Array.isArray(change.state.values)).toBe(true);
  expect(change.state.values.length).toBe(4);
  expect([...change.state.values]).toEqual([1, 4, 5, 3]);
  expect(change.state.values.map((value) => value * 2)).toEqual([2, 8, 10, 6]);
  expect(Object.keys(change.state.values)).toEqual(["0", "1", "2", "3"]);
  expect(Object.getOwnPropertyDescriptor(change.state.values, "2")?.value).toBe(5);
  expect(Object.keys(change.state.object)).toEqual(["a", "b"]);
  expect(JSON.parse(JSON.stringify(change.state))).toEqual({
    values: [1, 4, 5, 3],
    object: { a: 1, b: 2 },
  });
  change.abort();
};

const keepsDocumentKeysDistinctFromObject = (): void => {
  const tracker = track({
    object: {
      context: 1,
      base: 2,
      parent: 3,
      dirty: 4,
      target: 5,
      proxy: 6,
    },
  });
  const change = tracker.beginChange();
  change.state.object.context = 7;
  change.state.object.proxy = 8;
  expect(Object.keys(change.state.object)).toEqual([
    "context",
    "base",
    "parent",
    "dirty",
    "target",
    "proxy",
  ]);
  const prepared = change.prepare();
  expect(prepared.value.object).toEqual({
    context: 7,
    base: 2,
    parent: 3,
    dirty: 4,
    target: 5,
    proxy: 8,
  });
  tracker.adopt(prepared);
};

const keepsNativeCoercionSideEffectsAnd = (): void => {
  const tracker = track({ text: "abcdefgh", values: [1, 2, 3], marker: 0 });
  const change = tracker.beginChange();
  change.state.text = `${change.state.text.slice(3)}xyz`;
  change.state.values.splice(
    {
      valueOf() {
        change.state.marker = 1;
        return 1;
      },
    } as unknown as number,
    1,
    4,
  );
  const prepared = change.prepare();
  expect(prepared.value).toEqual({ text: "defghxyz", values: [1, 4, 3], marker: 1 });
  expect(prepared.ops).toContainEqual(["t", ["text"], 3]);
  expect(prepared.ops).toContainEqual(["a", ["text"], "xyz"]);
  expect(replay(tracker.value, decoder().decode(encoder().encode(prepared.ops)))).toEqual(
    prepared.value,
  );
  tracker.adopt(prepared);
};

const emitsDeletionAndSupportsRootArrays = (): void => {
  const objectTracker = track({ keep: 1, remove: 2 } as { keep: number; remove?: number });
  settle(objectTracker, (draft) => {
    delete draft.remove;
  });
  expect(objectTracker.value).toEqual({ keep: 1 });

  const arrayTracker = track([1, 2, 3]);
  settle(arrayTracker, (draft) => {
    draft.reverse();
    draft.push(4);
  });
  expect(arrayTracker.value).toEqual([3, 2, 1, 4]);
};

const preservesNativeObjectKeyOrderAfter = (): void => {
  const tracker = track({ first: 1, second: 2 } as { first?: number; second: number });
  const change = tracker.beginChange();
  delete change.state.first;
  change.state.first = 1;
  expect(Object.keys(change.state)).toEqual(["second", "first"]);
  const prepared = change.prepare();
  tracker.adopt(prepared);
  expect(Object.keys(tracker.value)).toEqual(["second", "first"]);
};

const ordersNewIntegerLikeObjectKeys = (): void => {
  const tracker = track({ object: { label: "x" } as Record<string, string>, first: "" });
  const base = clone(tracker.value);
  const change = tracker.beginChange();
  change.state.object["2"] = "two";
  change.state.object["1"] = "one";
  expect(Object.keys(change.state.object)).toEqual(["1", "2", "label"]);
  change.state.first = Object.keys(change.state.object)[0]!;
  const prepared = change.prepare();
  expect(prepared.value.first).toBe("1");
  expect(Object.keys(prepared.value.object)).toEqual(["1", "2", "label"]);
  expect(replay(base, prepared.ops)).toEqual(prepared.value);
  tracker.adopt(prepared);
  expect(tracker.value.first).toBe("1");
  expect(Object.keys(tracker.value.object)).toEqual(["1", "2", "label"]);
};

const normalizesDeeplyEqualContainerAssignmentsBefore = (): void => {
  const initial = { child: { a: 1, b: 2 }, count: 0 };
  const tracker = track(initial);
  const change = tracker.beginChange();
  change.state.child = { b: 2, a: 1 };
  change.state.count = 1;
  const prepared = change.prepare();
  const replayed = replay(initial, prepared.ops);
  expect(prepared.ops).toEqual([["s", ["count"], 1]]);
  expect(Object.keys(prepared.value.child)).toEqual(["a", "b"]);
  expect(Object.keys(replayed.child)).toEqual(["a", "b"]);
  expect(prepared.value).toEqual(replayed);
  tracker.adopt(prepared);
};

const keepsNativeIntegerAndStringOrdering = (): void => {
  const tracker = track({
    object: { 1: "one", 2: "two", first: "a", second: "b" } as Record<string, string>,
  });
  const change = tracker.beginChange();
  delete change.state.object["2"];
  change.state.object["2"] = "two";
  delete change.state.object["first"];
  change.state.object["first"] = "a";
  change.state.object["3"] = "three";
  change.state.object["0"] = "zero";
  expect(Object.keys(change.state.object)).toEqual(["0", "1", "2", "3", "second", "first"]);
  const prepared = change.prepare();
  expect(Object.keys(prepared.value.object)).toEqual(["0", "1", "2", "3", "second", "first"]);
  tracker.adopt(prepared);
  expect(Object.keys(tracker.value.object)).toEqual(["0", "1", "2", "3", "second", "first"]);
};

const ordersIntegerLikeKeysOnNull = (): void => {
  const object = Object.create(null) as Record<string, string>;
  object["label"] = "x";
  const tracker = track({ object });
  const base = clone(tracker.value);
  const change = tracker.beginChange();
  change.state.object["2"] = "two";
  change.state.object["1"] = "one";
  expect(Object.keys(change.state.object)).toEqual(["1", "2", "label"]);
  const prepared = change.prepare();
  expect(Object.getPrototypeOf(prepared.value.object)).toBeNull();
  expect(Object.keys(prepared.value.object)).toEqual(["1", "2", "label"]);
  expect(replay(base, prepared.ops)).toEqual(prepared.value);
  tracker.adopt(prepared);
  expect(Object.getPrototypeOf(tracker.value.object)).toBeNull();
  expect(Object.keys(tracker.value.object)).toEqual(["1", "2", "label"]);
};

const forwardsBorrowedMutatorsToOrdinaryGeneric = (): void => {
  const tracker = track({ values: [1, 2, 3] });
  const change = tracker.beginChange();
  const receiver = [3, 1, 2];
  const push = change.state.values.push;
  const splice = change.state.values.splice;
  const sort = change.state.values.sort;
  const fill = change.state.values.fill;
  const copyWithin = change.state.values.copyWithin;
  expect(Reflect.apply(push, receiver, [4])).toBe(4);
  expect(Reflect.apply(splice, receiver, [1, 1, 5])).toEqual([1]);
  expect(Reflect.apply(sort, receiver, [(left: number, right: number) => left - right])).toBe(
    receiver,
  );
  expect(Reflect.apply(fill, receiver, [7, 1, 2])).toBe(receiver);
  expect(Reflect.apply(copyWithin, receiver, [2, 0, 1])).toBe(receiver);
  expect(receiver).toEqual([2, 7, 2, 5]);
  expect(change.state.values).toEqual([1, 2, 3]);
  change.abort();
};

describe("delta tracker policy view", () => {
  it(
    "supports native reads, descriptors, keys, iteration, map, and JSON",
    supportsNativeReadsDescriptorsKeysIteration,
  );

  it(
    "keeps document keys distinct from object proxy target fields",
    keepsDocumentKeysDistinctFromObject,
  );

  it(
    "keeps native coercion side effects and string operation forms",
    keepsNativeCoercionSideEffectsAnd,
  );

  it("emits deletion and supports root arrays", emitsDeletionAndSupportsRootArrays);

  it(
    "preserves native object key order after delete and re-add",
    preservesNativeObjectKeyOrderAfter,
  );

  it(
    "orders new integer-like object keys before strings for recipe-visible reads",
    ordersNewIntegerLikeObjectKeys,
  );

  it(
    "normalizes deeply equal container assignments before direct candidate materialization",
    normalizesDeeplyEqualContainerAssignmentsBefore,
  );

  it(
    "keeps native integer and string ordering across deletion and re-addition",
    keepsNativeIntegerAndStringOrdering,
  );

  it("orders integer-like keys on null-prototype objects", ordersIntegerLikeKeysOnNull);

  it(
    "forwards borrowed mutators to ordinary generic array receivers",
    forwardsBorrowedMutatorsToOrdinaryGeneric,
  );
});
