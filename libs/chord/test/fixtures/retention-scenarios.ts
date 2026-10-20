import assert from "node:assert/strict";

import { Effect } from "effect";

import { track } from "../../src/delta/index.ts";
import retention from "./retention.ts";

const { collect, retainedSettledChanges } = retention;

const largeProxyScenarios: Readonly<Record<string, Effect.Effect<void>>> = {
  "retained-large-placement-proxies": Effect.gen(function* () {
    type Root = {
      child: { value: number };
      visited: { value: number }[];
      first: number[] | null;
      second: number[] | null;
      rows: Array<number[] | null>;
    };
    const run = (kind: "write" | "writes" | "insert" | "override"): WeakRef<object> => {
      const tracker = track<Root>({
        child: { value: 0 },
        first: null,
        rows: kind === "override" ? [null] : [],
        second: null,
        visited: Array.from({ length: 5_000 }, (_, value) => ({ value })),
      });
      const change = tracker.beginChange();
      for (const value of change.state.visited) assert.equal(value.value >= 0, true);
      let held: object;
      if (kind === "write" || kind === "writes") {
        held = change.state.child;
        change.state.first = Array<number>(50_000).fill(1);
        if (kind === "writes") change.state.second = Array<number>(50_000).fill(2);
      } else {
        held = change.state.rows;
        if (kind === "insert") change.state.rows.push(Array<number>(50_000).fill(1));
        else change.state.rows[0] = Array<number>(50_000).fill(1);
      }
      const prepared = change.prepare();
      const payload =
        kind === "write" || kind === "writes" ? prepared.value.first : prepared.value.rows[0];
      assert.ok(payload);
      const reference = new WeakRef(payload);
      tracker.adopt(prepared);
      const replacement = tracker.prepareReplace({
        child: { value: 1 },
        first: null,
        rows: [],
        second: null,
        visited: [],
      });
      tracker.adopt(replacement);
      retainedSettledChanges.push(held);
      return reference;
    };
    const references = [run("write"), run("writes"), run("insert"), run("override")];
    yield* Effect.forEach(references, collect, { discard: true });
    for (const held of retainedSettledChanges)
      assert.throws(() => Reflect.get(held, "length"), /settled/u);
  }),
  "retained-large-settled-proxy": Effect.gen(function* () {
    const tracker = track({ rows: Array.from({ length: 100_000 }, (_, value) => ({ value })) });
    const obsolete = new WeakRef(tracker.value.rows);
    const commit = (): object => {
      const change = tracker.beginChange();
      const held = change.state.rows[0]!;
      for (let index = 1; index < 5_000; index++)
        assert.equal(change.state.rows[index]!.value, index);
      held.value = -1;
      const prepared = change.prepare();
      tracker.adopt(prepared);
      return held;
    };
    retainedSettledChanges.push(commit());
    const replace = (): void => {
      const replacement = tracker.prepareReplace({ rows: [{ value: 1 }] });
      tracker.adopt(replacement);
    };
    replace();
    yield* collect(obsolete);
    assert.throws(() => (retainedSettledChanges[0] as { value: number }).value, /settled/u);
  }),
  "same-job-fast-cleanup": Effect.sync(() => {
    assert.ok(global.gc, "worker requires --expose-gc");
    const tracker = track({ rows: Array.from({ length: 100_000 }, (_, value) => ({ value })) });
    global.gc();
    const readyHeap = process.memoryUsage().heapUsed;
    const commit = (value: number): void => {
      const change = tracker.beginChange();
      const draft = change.state;
      for (let index = 0; index < 4_094; index++) assert.equal(draft.rows[index]!.value, index);
      draft.rows.at(-1)!.value = value;
      const prepared = change.prepare();
      tracker.adopt(prepared);
    };
    for (let value = 0; value < 100; value++) commit(-value - 1);
    global.gc();
    const retainedMiB = (process.memoryUsage().heapUsed - readyHeap) / (1024 * 1024);
    assert.ok(retainedMiB < 16, `same-job cleanup retained ${retainedMiB.toFixed(2)} MiB`);
    assert.equal(tracker.value.rows.at(-1)!.value, -100);
  }),
  "same-job-folded-ops-cleanup": Effect.sync(() => {
    assert.ok(global.gc, "worker requires --expose-gc");
    const tracker = track(
      Object.fromEntries(
        Array.from({ length: 5_000 }, (_, index) => [`field${index}`, 0]),
      ) as Record<string, number>,
    );
    global.gc();
    const readyHeap = process.memoryUsage().heapUsed;
    const commit = (value: number): void => {
      const change = tracker.beginChange();
      for (let index = 0; index < 5_000; index++) change.state[`field${index}`] = value;
      const prepared = change.prepare();
      assert.equal(prepared.ops.length, 1);
      assert.equal(prepared.ops[0]![0], "r");
      tracker.adopt(prepared);
    };
    for (let value = 1; value <= 100; value++) commit(value);
    global.gc();
    const retainedMiB = (process.memoryUsage().heapUsed - readyHeap) / (1024 * 1024);
    assert.ok(retainedMiB < 8, `same-job folded operations retained ${retainedMiB.toFixed(2)} MiB`);
    assert.equal(tracker.value["field0"], 100);
  }),
  "stale-unprepared-change": Effect.gen(function* () {
    const tracker = track({
      payload: { rows: Array.from({ length: 50_000 }, (_, value) => ({ value })) },
    });
    const stale = tracker.beginChange();
    stale.state.payload.rows[0]!.value = -1;
    const obsolete = new WeakRef(tracker.value.payload.rows);
    const replace = (): void => {
      const winner = tracker.prepareReplace({ payload: { rows: [{ value: 1 }] } });
      tracker.adopt(winner);
    };
    replace();
    assert.throws(() => stale.prepare(), /settled/u);
    retainedSettledChanges.push(stale);
    yield* collect(obsolete);
    assert.equal(retainedSettledChanges.length, 1);
  }),
};

export default largeProxyScenarios;
