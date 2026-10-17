import assert from "node:assert/strict";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

import { Clock, Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import { createHost, defineRegistry, type Facet, local, method } from "../src/index.ts";

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;

function tracker() {
  const alive = new Set<number>();
  const registry = new FinalizationRegistry<number>((id) => alive.delete(id));
  return {
    alive,
    track<T extends object>(id: number, value: T): T {
      alive.add(id);
      registry.register(value, id);
      return value;
    },
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
  };
}

const Store = local("t.gen-store", {
  version: 1,
  input: Type.Object({}),
  members: { get: method(undefined, Type.Number()), count: Type.Number() },
});
const Routes = defineRegistry<() => number>("t.gen-routes");
const RELOADS = 6;

describe("generation GC", () => {
  it("a reference held across reloads keeps only the current generation alive", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const generations = tracker();
        const host = createHost({ self: { kind: "host" }, onError: () => {} });
        const facet = (generation: number): Facet => {
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
      }),
    ));

  it('a lifetime "host" object with state, a kept resource, a listener, a task and registrations keeps only the current generation alive', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const services = yield* Effect.context<never>();
        const generations = tracker();
        const host = createHost({ self: { kind: "host" }, onError: () => {} });
        const facet = (generation: number): Facet => {
          const sentinel = generations.track(generation, { generation });
          return {
            name: "store",
            setup: (api) =>
              api.serve(
                Store,
                (_input, _principal, self) => {
                  const count = self.state("count", Type.Number(), 0);
                  self.resource("conn", {
                    version: 1,
                    open: () => ({ open: true }),
                    close: () => void sentinel.generation,
                  });
                  self.on("count", count, () => void sentinel.generation);
                  self.task((ctx) =>
                    Effect.runPromiseWith(services)(
                      Effect.gen(function* () {
                        yield* Effect.promise(
                          () =>
                            new Promise<void>((resolve) =>
                              ctx.signal.addEventListener("abort", () => resolve()),
                            ),
                        );
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
      }),
    ));

  it("abort listeners that calls and tasks add to their ctx.signal do not outlive them", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const services = yield* Effect.context<never>();
        const generations = tracker();
        const host = createHost({ self: { kind: "host" }, onError: () => {} });
        const facet = (generation: number): Facet => {
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
                        yield* Effect.promise(
                          () =>
                            new Promise<void>((resolve) =>
                              ctx.signal.addEventListener("abort", () => resolve()),
                            ),
                        );
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
      }),
    ));

  it("disposed objects are not kept once their disposal finished", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const services = yield* Effect.context<never>();
        const objects = tracker();
        const Item = local("t.gen-item", {
          version: 1,
          input: Type.Object({ id: Type.Number() }),
          members: { id: method(undefined, Type.Number()) },
        });
        const host = createHost({ self: { kind: "host" }, onError: () => {} });
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
      }),
    ));
});
