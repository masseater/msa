import assert from "node:assert/strict";

import { Console, Effect } from "effect";

import { type Tracker, track } from "../../src/delta/index.ts";
import largeProxyScenarios from "../fixtures/retention-scenarios.ts";
import retentionModule from "../fixtures/retention.ts";

const {
  abortedPayload,
  assertRetained,
  collect,
  draftProxies,
  retainedLargePrepared,
  retainedSettledChanges,
  settledLifecycle,
  unadoptedPrepared,
} = retentionModule;

type NullPayload = Tracker<{ payload: { rows: { value: number }[] } | null }>;

const releasedFromNullPayload = (make: (tracker: NullPayload) => WeakRef<object>) =>
  Effect.gen(function* () {
    const tracker = track<{ payload: { rows: { value: number }[] } | null }>({ payload: null });
    const reference = make(tracker);
    yield* collect(reference);
    assert.deepEqual(tracker.value, { payload: null });
  });

const scenarios: Readonly<Record<string, Effect.Effect<void>>> = {
  "aborted-payload": releasedFromNullPayload(abortedPayload),
  "draft-proxies": releasedFromNullPayload(draftProxies),
  "lifecycle-churn": Effect.sync(() => {
    const tracker = track({ value: 0 });
    for (let index = 0; index < 100_000; index++) {
      const change = tracker.beginChange();
      change.state.value = index;
      change.abort();
    }
    const prepared = tracker.prepareReplace({ value: 1 });
    tracker.adopt(prepared);
    assert.deepEqual(tracker.value, { value: 1 });
  }),
  "obsolete-revisions": Effect.gen(function* () {
    const tracker = track({
      payload: { rows: Array.from({ length: 50_000 }, (_, value) => ({ value })) },
    });
    const oldRoot = new WeakRef(tracker.value.payload.rows);
    const replace = (value: number): void => {
      const prepared = tracker.prepareReplace({ payload: { rows: [{ value }] } });
      tracker.adopt(prepared);
    };
    for (let value = 0; value < 100; value++) replace(value);
    yield* collect(oldRoot);
    assert.deepEqual(tracker.value, { payload: { rows: [{ value: 99 }] } });
  }),
  "retained-settled-change": Effect.gen(function* () {
    const tracker = track({
      payload: { rows: Array.from({ length: 50_000 }, (_, value) => ({ value })) },
    });
    const settleChange = (): { base: WeakRef<object>; value: WeakRef<object> } => {
      const change = tracker.beginChange();
      change.state.payload.rows[0]!.value = -1;
      const prepared = change.prepare();
      const references = {
        base: new WeakRef(prepared.base.payload.rows),
        value: new WeakRef(prepared.value.payload.rows),
      };
      tracker.adopt(prepared);
      retainedSettledChanges.push(change);
      return references;
    };
    const references = settleChange();
    const replace = (): void => {
      const replacement = tracker.prepareReplace({ payload: { rows: [{ value: 1 }] } });
      tracker.adopt(replacement);
    };
    replace();
    yield* collect(references.base);
    yield* collect(references.value);
    assert.equal(retainedSettledChanges.length, 1);
  }),
  "retained-settled-prepared": Effect.gen(function* () {
    const tracker = track({
      payload: { rows: Array.from({ length: 50_000 }, (_, value) => ({ value })) },
    });
    const retain = (): { base: WeakRef<object>; value: WeakRef<object> } => {
      const change = tracker.beginChange();
      change.state.payload.rows[0]!.value = -1;
      const prepared = change.prepare();
      const references = {
        base: new WeakRef(prepared.base.payload.rows),
        value: new WeakRef(prepared.value.payload.rows),
      };
      tracker.adopt(prepared);
      retainedLargePrepared.push(prepared);
      return references;
    };
    const references = retain();
    const replace = (): void => {
      const replacement = tracker.prepareReplace({ payload: { rows: [{ value: 1 }] } });
      tracker.adopt(replacement);
    };
    replace();
    yield* assertRetained(references.base);
    yield* assertRetained(references.value);
    retainedLargePrepared.length = 0;
    yield* collect(references.base);
    yield* collect(references.value);
  }),
  "retained-settled-proxy": Effect.gen(function* () {
    const tracker = track({
      child: { value: 0 },
      payload: { rows: Array.from({ length: 50_000 }, (_, value) => ({ value })) },
    });
    const obsolete = new WeakRef(tracker.value.payload.rows);
    const commit = (): object => {
      const change = tracker.beginChange();
      const held = change.state.child;
      held.value = 1;
      const prepared = change.prepare();
      tracker.adopt(prepared);
      return held;
    };
    retainedSettledChanges.push(commit());
    const replace = (): void => {
      const replacement = tracker.prepareReplace({
        child: { value: 2 },
        payload: { rows: [{ value: 1 }] },
      });
      tracker.adopt(replacement);
    };
    replace();
    yield* collect(obsolete);
    assert.throws(() => (retainedSettledChanges[0] as { value: number }).value, /settled/u);
  }),
  "settled-lifecycle": Effect.gen(function* () {
    const references = settledLifecycle();
    yield* collect(references.tracker);
    yield* collect(references.future);
  }),
  "unadopted-prepared": releasedFromNullPayload(unadoptedPrepared),
  ...largeProxyScenarios,
};

const scenario = process.argv[2] ?? "";
const run = scenarios[scenario];
if (run === undefined) throw new Error(`unknown retention scenario: ${scenario}`);
void Effect.runPromise(
  run.pipe(Effect.andThen(Console.log(JSON.stringify({ passed: true, scenario })))),
);
