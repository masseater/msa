import assert from "node:assert/strict";

import { Effect } from "effect";

import { type Tracker, track } from "../../src/delta/index.ts";
import { tick } from "./timing.ts";

export const retainedSettledObjects: object[] = [];
export const retainedLargePrepared: object[] = [];
export const retainedSettledChanges: object[] = [];

export const collect = (ref: WeakRef<object>): Effect.Effect<void> =>
  Effect.gen(function* () {
    assert.ok(global.gc, "worker requires --expose-gc");
    for (let attempt = 0; attempt < 30; attempt++) {
      yield* tick;
      global.gc();
      if (ref.deref() === undefined) return;
    }
    assert.fail("released change data is still retained");
  });

export function abortedPayload(
  tracker: Tracker<{ payload: { rows: { value: number }[] } | null }>,
): WeakRef<object> {
  const change = tracker.beginChange();
  change.state.payload = { rows: Array.from({ length: 50_000 }, (_, value) => ({ value })) };
  const reference = new WeakRef(change.state.payload.rows);
  change.abort();
  return reference;
}

export function unadoptedPrepared(
  tracker: Tracker<{ payload: { rows: { value: number }[] } | null }>,
): WeakRef<object> {
  const change = tracker.beginChange();
  change.state.payload = { rows: Array.from({ length: 50_000 }, (_, value) => ({ value })) };
  const prepared = change.prepare();
  return new WeakRef(prepared.value.payload!.rows);
}

export function draftProxies(
  tracker: Tracker<{ payload: { rows: { value: number }[] } | null }>,
): WeakRef<object> {
  const change = tracker.beginChange();
  change.state.payload = { rows: [{ value: 1 }] };
  const reference = new WeakRef(change.state.payload.rows[0]!);
  change.abort();
  return reference;
}

export const assertRetained = (reference: WeakRef<object>): Effect.Effect<void> =>
  Effect.gen(function* () {
    assert.ok(global.gc, "worker requires --expose-gc");
    for (let attempt = 0; attempt < 5; attempt++) {
      yield* tick;
      global.gc();
    }
    assert.notEqual(
      reference.deref(),
      undefined,
      "retained Prepared must retain its immutable revisions",
    );
  });

export function settledLifecycle(): { tracker: WeakRef<object>; future: WeakRef<object> } {
  const tracker = track<{ payload: { rows: { value: number }[] } | null }>({ payload: null });
  const change = tracker.beginChange();
  change.state.payload = { rows: [{ value: 1 }] };
  const retainedPrepared = change.prepare();
  tracker.adopt(retainedPrepared);
  retainedSettledObjects.push(change, retainedPrepared);

  const futurePrepared = tracker.prepareReplace({
    payload: { rows: Array.from({ length: 50_000 }, (_, value) => ({ value })) },
  });
  tracker.adopt(futurePrepared);
  return {
    tracker: new WeakRef(tracker),
    future: new WeakRef(futurePrepared.value.payload!.rows),
  };
}
