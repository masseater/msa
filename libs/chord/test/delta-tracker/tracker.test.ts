import { isProxy } from "node:util/types";

import { Effect, Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { track } from "../../src/delta/index.ts";
import { clone } from "../fixtures/tracker.ts";

const materializesAnImmutableNextRevisionAnd = (): void => {
  const initial = { count: 1, nested: { text: "a" }, values: [1] };
  const tracker = track(initial);
  expect(tracker.value).toBe(initial);
  const change = tracker.beginChange();
  change.state.count = 2;
  change.state.nested.text += "b";
  change.state.values.push(2);
  expect(initial).toEqual({ count: 1, nested: { text: "a" }, values: [1] });
  const prepared = change.prepare();
  const next = prepared.value;
  expect(prepared.baseRevision).toBe(0);
  expect(prepared.base).toBe(initial);
  expect(next).not.toBe(initial);
  expect(isProxy(next)).toBe(false);
  expect(next).toEqual({ count: 2, nested: { text: "ab" }, values: [1, 2] });
  expect(prepared.ops).toEqual([
    ["s", ["count"], 2],
    ["a", ["nested", "text"], "b"],
    ["p", ["values"], 1, 0, [2]],
  ]);
  expect(tracker.value).toBe(initial);
  tracker.adopt(prepared);
  expect(initial).toEqual({ count: 1, nested: { text: "a" }, values: [1] });
  expect(tracker.value).toBe(next);
  expect(prepared.value).toBe(next);
  expect(prepared.base).toBe(initial);
  expect(() => change.state.count).toThrow(TypeError);
};

const keepsATransactionLiveAcrossAwait = Effect.gen(function* () {
  const tracker = track({ left: 0, nested: { right: 0 } });
  const change = tracker.beginChange();
  change.state.left = 1;
  yield* Effect.promise(() => Promise.resolve());
  change.state.nested.right = 2;
  const prepared = change.prepare();
  expect(prepared.value).toEqual({ left: 1, nested: { right: 2 } });
  expect(() => {
    change.state.left = 3;
  }).toThrow(/settled/u);
  tracker.adopt(prepared);
});

const allowsPromiseResolutionToInspectA = Effect.gen(function* () {
  const initial = (yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(
    '{"then":"document-value","value":1}',
  )) as {
    then: string;
    value: number;
  };
  const tracker = track(initial);
  const change = tracker.beginChange();
  const draft = change.state;
  expect(draft.then).toBe("document-value");
  draft.value = 2;
  const prepared = change.prepare();

  const resolved = yield* Effect.promise(() => Promise.resolve(draft));
  expect(resolved).toBe(draft);
  expect(resolved.then).toBeUndefined();
  expect(() => resolved.value).toThrow(/settled/u);

  tracker.adopt(prepared);
  expect(tracker.value.then).toBe("document-value");
  expect(tracker.value.value).toBe(2);

  const largeTracker = track({
    rows: Array.from({ length: 4_100 }, (_, value) => ({ value })),
  });
  const largeChange = largeTracker.beginChange();
  const largeDraft = largeChange.state;
  for (const row of largeDraft.rows) expect(row.value).toBeGreaterThanOrEqual(0);
  largeDraft.rows[0]!.value = -1;
  const largePrepared = largeChange.prepare();
  expect(yield* Effect.promise(() => Promise.resolve(largeDraft))).toBe(largeDraft);
  expect(() => largeDraft.rows).toThrow(/settled/u);
  largeTracker.adopt(largePrepared);
});

const abortsIdempotentlyAndRevokesHeldDescendants = (): void => {
  const tracker = track({ child: { value: 1 } });
  const change = tracker.beginChange();
  const child = change.state.child;
  child.value = 2;
  change.abort();
  change.abort();
  expect(tracker.value.child.value).toBe(1);
  expect(() => child.value).toThrow(TypeError);
  expect(() => change.prepare()).toThrow(/settled/u);
};

const allowsCompetingContextsAndInvalidatesLoser = (): void => {
  const tracker = track({ value: 0 });
  const first = tracker.beginChange();
  const second = tracker.beginChange();
  first.state.value = 1;
  second.state.value = 2;
  const firstPrepared = first.prepare();
  const secondPrepared = second.prepare();
  const held = secondPrepared.value;
  tracker.adopt(firstPrepared);
  expect(tracker.value.value).toBe(1);
  expect(held.value).toBe(2);
  expect(() => tracker.adopt(secondPrepared)).toThrow(/stale/u);
  expect(() => tracker.adopt(firstPrepared)).toThrow(/already been used/u);
};

const invalidatesCompetingOpenOverlaysWithoutChanging = (): void => {
  const initial = { rows: [{ value: 0 }, { value: 1 }] };
  const tracker = track(initial);
  const staleChange = tracker.beginChange();
  const held = staleChange.state.rows[1]!;
  held.value = 2;

  const winner = tracker.beginChange();
  winner.state.rows[0]!.value = 3;
  const prepared = winner.prepare();
  tracker.adopt(prepared);

  expect(initial).toEqual({ rows: [{ value: 0 }, { value: 1 }] });
  expect(tracker.value).toEqual({ rows: [{ value: 3 }, { value: 1 }] });
  expect(() => held.value).toThrow(/settled/u);
  expect(() => staleChange.prepare()).toThrow(/settled/u);
  staleChange.abort();
};

const adoptsObjectEditsAsOrdinaryFast = (): void => {
  const initial = { first: 1, second: 2 } as { first: number; second?: number; third?: number };
  const tracker = track(initial);
  const change = tracker.beginChange();
  change.state.first = 3;
  delete change.state.second;
  change.state.third = 4;
  const prepared = change.prepare();
  tracker.adopt(prepared);
  expect(tracker.value).not.toBe(initial);
  expect(initial).toEqual({ first: 1, second: 2 });
  expect(tracker.value).toEqual({ first: 3, third: 4 });
  expect(Object.getOwnPropertyDescriptor(tracker.value, "third")).toEqual({
    value: 4,
    writable: true,
    enumerable: true,
    configurable: true,
  });
};

const supportsAdoptThenPublishOrderingAnd = (): void => {
  const tracker = track({ value: 0, nested: { count: 0 } });
  const change = tracker.beginChange();
  change.state.value = 1;
  change.state.nested.count = 1;
  const prepared = change.prepare();
  const operations = prepared.ops;
  tracker.adopt(prepared);
  expect(prepared.ops).toBe(operations);
  const published = prepared.ops.length === 0 ? undefined : prepared.value;
  expect(operations).toHaveLength(2);
  expect(published).toBeDefined();
  expect(published).toBe(tracker.value);
  expect(clone(published!)).toEqual({ value: 1, nested: { count: 1 } });

  const next = tracker.beginChange();
  next.state.value = 2;
  const nextPrepared = next.prepare();
  tracker.adopt(nextPrepared);
  expect(published).not.toBe(tracker.value);
  expect(prepared.value).toEqual({ value: 1, nested: { count: 1 } });
  expect(tracker.value).toEqual({ value: 2, nested: { count: 1 } });
};

const keepsReplacementBaseValueStructurallyCompatible = (): void => {
  const original = { value: 0 };
  const replacement = { value: 1 };
  const tracker = track(original);
  const prepared = tracker.prepareReplace(replacement);
  expect(prepared.base).toBe(original);
  expect(prepared.value).toBe(replacement);
  tracker.adopt(prepared);
  expect(prepared.base).toBe(original);
  expect(prepared.value).toBe(replacement);
  expect(prepared.value).toBe(tracker.value);
};

describe("delta tracker transactional overlay lifecycle", () => {
  it(
    "materializes an immutable next revision and adopts it by pointer swap",
    materializesAnImmutableNextRevisionAnd,
  );

  it("keeps a transaction live across await and seals it only at prepare", () =>
    Effect.runPromise(keepsATransactionLiveAcrossAwait));

  it("allows Promise resolution to inspect a settled draft without reporting a false failure", () =>
    Effect.runPromise(allowsPromiseResolutionToInspectA));

  it(
    "aborts idempotently and revokes held descendants",
    abortsIdempotentlyAndRevokesHeldDescendants,
  );

  it(
    "allows competing contexts and invalidates loser views",
    allowsCompetingContextsAndInvalidatesLoser,
  );

  it(
    "invalidates competing open overlays without changing their base revision",
    invalidatesCompetingOpenOverlaysWithoutChanging,
  );

  it(
    "adopts object edits as ordinary fast-layout immutable revisions",
    adoptsObjectEditsAsOrdinaryFast,
  );

  it(
    "supports adopt-then-publish ordering and retained publication reads",
    supportsAdoptThenPublishOrderingAnd,
  );

  it(
    "keeps replacement base/value structurally compatible and readable after adoption",
    keepsReplacementBaseValueStructurallyCompatible,
  );
});
