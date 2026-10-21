import assert from "node:assert/strict";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

import { Clock, type Context, Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import chord from "../src/index.ts";
import type chordTypes from "../src/index.types.ts";
import timing from "./fixtures/timing.ts";

const { createHost, defineRegistry, local, method } = chord;

const { abortOf } = timing;

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;

function tracker() {
  const alive = new Set<number>();
  const registry = new FinalizationRegistry<number>((id) => alive.delete(id));
  return {
    alive,
    collect(expected: readonly number[], timeout = 5000): Promise<number[]> {
      const sorted = () => [...alive].sort((a, b) => a - b);
      return Effect.runPromise(
        Effect.gen(function* () {
          const deadline = (yield* Clock.currentTimeMillis) + timeout;
          do {
            gc();
            yield* Effect.sleep(10);
            if (sorted().join() === expected.join()) break;
          } while ((yield* Clock.currentTimeMillis) < deadline);
          return sorted();
        }),
      );
    },
    track<T extends object>(id: number, value: T): T {
      alive.add(id);
      registry.register(value, id);
      return value;
    },
  };
}

const Store = local("t.gen-store", {
  input: Type.Object({}),
  members: { count: Type.Number(), get: method(undefined, Type.Number()) },
  version: 1,
});
const Routes = defineRegistry<() => number>("t.gen-routes");
const RELOADS = 6;

const aReferenceHeldAcrossReloadsKeeps = Effect.gen(function* () {
  const generations = tracker();
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  const facet = (generation: number): chordTypes.Facet => {
    const sentinel = generations.track(generation, { generation });
    return {
      name: "store",
      setup: (api) =>
        api.serve(Store, (_input, _principal, self) => {
          const count = self.state("count", Type.Number(), 0);
          return { count, get: () => sentinel.generation };
        }),
    };
  };
  host.install(facet(0));
  const ref = host.hold(Store, {});
  yield* Effect.promise(() => ref.ready);
  for (let generation = 1; generation <= RELOADS; generation++) {
    yield* Effect.promise(() => host.reload([facet(generation)]));
    assert.equal(yield* Effect.promise(() => ref.get()), generation);
  }
  assert.deepEqual(yield* Effect.promise(() => generations.collect([RELOADS])), [RELOADS]);
  yield* Effect.promise(() => host.close());
});

const aLifetimeHostObjectWithState = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const generations = tracker();
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  const facet = (generation: number): chordTypes.Facet => {
    const sentinel = generations.track(generation, { generation });
    return {
      name: "store",
      setup: (api) =>
        api.serve(
          Store,
          (_input, _principal, self) => {
            const count = self.state("count", Type.Number(), 0);
            self.resource("conn", {
              close: () => void sentinel.generation,
              open: () => ({ open: true }),
              version: 1,
            });
            self.on("count", count, () => void sentinel.generation);
            self.task((ctx) =>
              Effect.runPromiseWith(services)(
                Effect.gen(function* () {
                  yield* abortOf(ctx.signal);
                  void sentinel.generation;
                }),
              ),
            );
            self.register(Routes, { generation: () => sentinel.generation });
            return { count, get: () => sentinel.generation };
          },
          { lifetime: "host" },
        ),
    };
  };
  yield* Effect.promise(() => host.install(facet(0)));
  for (let generation = 1; generation <= RELOADS; generation++) {
    yield* Effect.promise(() => host.reload([facet(generation)]));
    assert.equal(host.registry(Routes).get("generation")?.(), generation);
  }
  assert.deepEqual(yield* Effect.promise(() => generations.collect([RELOADS])), [RELOADS]);
  yield* Effect.promise(() => host.close());
});

const abortingStoreFacet = (
  generations: ReturnType<typeof tracker>,
  services: Context.Context<never>,
): ((generation: number) => chordTypes.Facet) => {
  const facet = (generation: number): chordTypes.Facet => {
    const sentinel = generations.track(generation, { generation });
    return {
      name: "store",
      setup: (api) =>
        api.serve(
          Store,
          (_input, _principal, self) => {
            const count = self.state("count", Type.Number(), 0);
            self.task((ctx) =>
              Effect.runPromiseWith(services)(
                Effect.gen(function* () {
                  yield* abortOf(ctx.signal);
                  void sentinel.generation;
                }),
              ),
            );
            return {
              count,
              get: (ctx) => {
                ctx.signal.addEventListener("abort", () => void sentinel.generation);
                return sentinel.generation;
              },
            };
          },
          { lifetime: "host" },
        ),
    };
  };
  return facet;
};

const abortListenersThatCallsAndTasks = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const generations = tracker();
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  const facet = abortingStoreFacet(generations, services);
  yield* Effect.promise(() => host.install(facet(0)));
  for (let generation = 1; generation <= RELOADS; generation++) {
    yield* Effect.promise(() => host.reload([facet(generation)]));
    assert.equal(
      yield* Effect.promise(() =>
        host.root((ctx) =>
          Effect.runPromiseWith(services)(
            Effect.gen(function* () {
              const remote = yield* Effect.promise(() => ctx.get(Store, {}));
              return yield* Effect.promise(() => remote.get(ctx));
            }),
          ),
        ),
      ),
      generation,
    );
  }
  assert.deepEqual(yield* Effect.promise(() => generations.collect([RELOADS])), [RELOADS]);
  yield* Effect.promise(() => host.close());
});

const disposedObjectsAreNotKeptOnce = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const objects = tracker();
  const Item = local("t.gen-item", {
    input: Type.Object({ id: Type.Number() }),
    members: { id: method(undefined, Type.Number()) },
    version: 1,
  });
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  host.serve(Item, (input) => {
    const { id } = objects.track(input.id, input);
    return { id: () => id };
  });
  const use = (id: number): Promise<void> =>
    Effect.runPromiseWith(services)(
      Effect.gen(function* () {
        const ref = host.hold(Item, { id });
        assert.equal(yield* Effect.promise(() => ref.id()), id);
        ref.release();
      }),
    );
  for (let id = 0; id < 50; id++) yield* Effect.promise(() => use(id));
  yield* Effect.sleep(10);
  assert.deepEqual(yield* Effect.promise(() => objects.collect([])), []);
  yield* Effect.promise(() => host.close());
});

describe("generation GC", () => {
  it("a reference held across reloads keeps only the current generation alive", () =>
    Effect.runPromise(aReferenceHeldAcrossReloadsKeeps));

  it('a lifetime "host" object with state, a kept resource, a listener, a task and registrations keeps only the current generation alive', () =>
    Effect.runPromise(aLifetimeHostObjectWithState));

  it("abort listeners that calls and tasks add to their ctx.signal do not outlive them", () =>
    Effect.runPromise(abortListenersThatCallsAndTasks));

  it("disposed objects are not kept once their disposal finished", () =>
    Effect.runPromise(disposedObjectsAreNotKeptOnce));
});
