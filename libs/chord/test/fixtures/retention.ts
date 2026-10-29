import assert from "node:assert/strict";

import testing from "@msa/testing";
import { Effect } from "effect";

import delta from "../../src/delta/index.ts";
import type deltaTypes from "../../src/delta/index.types.ts";
import timing from "./timing.ts";

const { track } = delta;

const { tick } = timing;
const { pollUntil } = testing;

const retainedSettledObjects: object[] = [];
const retainedLargePrepared: object[] = [];
const retainedSettledChanges: object[] = [];

const collect = (ref: WeakRef<object>): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { gc } = global;
    assert.ok(gc, "worker requires --expose-gc");
    yield* pollUntil(
      Effect.sync(() => {
        gc();
        return ref.deref() === undefined;
      }),
      30,
      tick,
    );
  });

function abortedPayload(
  tracker: deltaTypes.Tracker<{ payload: { rows: { value: number }[] } | null }>,
): WeakRef<object> {
  const change = tracker.beginChange();
  change.state.payload = { rows: Array.from({ length: 50_000 }, (_, value) => ({ value })) };
  const reference = new WeakRef(change.state.payload.rows);
  change.abort();
  return reference;
}

function unadoptedPrepared(
  tracker: deltaTypes.Tracker<{ payload: { rows: { value: number }[] } | null }>,
): WeakRef<object> {
  const change = tracker.beginChange();
  change.state.payload = { rows: Array.from({ length: 50_000 }, (_, value) => ({ value })) };
  const prepared = change.prepare();
  return new WeakRef(prepared.value.payload!.rows);
}

function draftProxies(
  tracker: deltaTypes.Tracker<{ payload: { rows: { value: number }[] } | null }>,
): WeakRef<object> {
  const change = tracker.beginChange();
  change.state.payload = { rows: [{ value: 1 }] };
  const reference = new WeakRef(change.state.payload.rows[0]!);
  change.abort();
  return reference;
}

const assertRetained = (reference: WeakRef<object>): Effect.Effect<void> =>
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

function settledLifecycle(): { tracker: WeakRef<object>; future: WeakRef<object> } {
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
    future: new WeakRef(futurePrepared.value.payload!.rows),
    tracker: new WeakRef(tracker),
  };
}

const retention = {
  abortedPayload,
  assertRetained,
  collect,
  draftProxies,
  retainedLargePrepared,
  retainedSettledChanges,
  retainedSettledObjects,
  settledLifecycle,
  unadoptedPrepared,
};

export default retention;
