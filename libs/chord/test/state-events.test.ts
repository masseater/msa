import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import delta from "../src/delta/index.ts";
import chord from "../src/index.ts";
import type chordTypes from "../src/index.types.ts";
import timing from "./fixtures/timing.ts";

const { createHost, local, method } = chord;
const { applyImmutable } = delta;

const { abortOf, tick } = timing;

function emitter<E>() {
  const listeners = new Set<(event: E) => void>();
  return {
    emit: (event: E) => {
      for (const fn of listeners) fn(event);
    },
    get size() {
      return listeners.size;
    },
    subscribe: (fn: (event: E) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

const listenersRunEachEventInA = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  const events = emitter<number>();
  const Watcher = local("t.watcher", {
    input: Type.Object({}),
    members: { seen: Type.Object({ sum: Type.Number() }) },
    version: 1,
  });
  const roots = new Set<string>();
  let taskAborted = false;
  host.serve(Watcher, (_input, _principal, self) => {
    const seen = self.state("seen", Type.Object({ sum: Type.Number() }), { sum: 0 });
    const sourceResource = self.resource("source", { open: () => events, version: 1 });
    self.on(
      "onEvent",
      sourceResource,
      (source) => source,
      (value, ctx) => {
        roots.add(ctx.rootId);
        seen.change(ctx, (draft) => {
          draft.sum += value;
        });
      },
    );
    self.task((ctx) =>
      Effect.runPromiseWith(services)(
        Effect.gen(function* () {
          yield* abortOf(ctx.signal);
          taskAborted = true;
        }),
      ),
    );
    return { seen };
  });
  const ref = host.hold(Watcher, {});
  yield* Effect.promise(() => ref.ready);
  events.emit(2);
  events.emit(3);
  yield* tick;
  assert.deepEqual(ref.seen.value, { sum: 5 });
  assert.equal(roots.size, 2);
  ref.release();
  yield* tick;
  yield* tick;
  assert.equal(events.size, 0);
  assert.ok(taskAborted);
});

const reEntrantWritesPublishInAdoption = Effect.gen(function* () {
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  const Echo = local("t.reentrant", {
    input: Type.Object({}),
    members: { d: Type.Number(), n: Type.Number(), set: method(Type.Number()) },
    version: 1,
  });
  host.serve(Echo, (_input, _principal, self) => {
    const nState = self.state("n", Type.Number(), 0);
    const d = self.derive([nState], (n) => n * 2);
    self.on("bump", nState, (n, ctx) => {
      if (n === 1) nState.replace(ctx, 2);
    });
    return {
      d,
      n: nState,
      set: (value: number, ctx: chordTypes.Ctx) => {
        nState.replace(ctx, value);
      },
    };
  });
  const ref = host.hold(Echo, {});
  yield* Effect.promise(() => ref.ready);
  const values: unknown[] = [];
  let replica: unknown;
  ref.n.events((event) => {
    replica = event.type === "ops" ? applyImmutable(replica, event.ops) : event.value;
    values.push(replica);
  });
  const doubled: unknown[] = [];
  ref.d.subscribe((value) => doubled.push(value));
  yield* Effect.promise(() => ref.set(1));
  yield* tick;
  assert.deepEqual(values, [0, 1, 2]);
  assert.equal(ref.d.value, 4);
  assert.deepEqual(doubled, [0, 2, 4]);
});

describe("state cells", () => {
  it("listeners run each event in a fresh root; tasks get an abortable ctx", () =>
    Effect.runPromise(listenersRunEachEventInA));

  it("re-entrant writes publish in adoption order; derivations never go stale (Sol #3)", () =>
    Effect.runPromise(reEntrantWritesPublishInAdoption));
});
