import assert from "node:assert/strict";

import { type Context, Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import chord from "../src/index.ts";
import type chordTypes from "../src/index.types.ts";
import review from "./fixtures/review.ts";
import timing from "./fixtures/timing.ts";

const { createHost, hostNamed, isChordError, local, method, remote } = chord;

const { Item } = review;
const { latch, tick, ticks } = timing;

const case7ObjectsOfTypesAReload = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  const log: string[] = [];
  const Fresh = local("t.fresh", { input: Type.Object({}), version: 1 });
  host.install({
    name: "item",
    setup: (api) => api.serve(Item, () => ({ version: () => "v1" })),
  });
  yield* Effect.promise(() => Promise.all(["a", "b"].map((id) => host.hold(Item, { id }).ready)));
  const plugins = (fail: boolean): chordTypes.Facet[] => [
    {
      name: "fresh",
      setup: (api) =>
        api.serve(Fresh, (_input, _principal, self) => {
          self.task(() =>
            Effect.runPromiseWith(services)(
              Effect.sync(() => {
                log.push("task started");
              }),
            ),
          );
          return {};
        }),
    },
    {
      name: "item",
      setup: (api) =>
        api.serve(Item, ({ id }, _principal, self) => {
          self.get(Fresh, {});
          if (fail && id === "b") throw new Error("b fails");
          return { version: () => "v2" };
        }),
    },
  ];
  yield* Effect.promise(() => assert.rejects(host.reload(plugins(true)), /b fails/u));
  yield* ticks();
  assert.deepEqual(log, []);
  yield* Effect.promise(() => host.reload(plugins(false)));
  yield* ticks();
  assert.deepEqual(log, ["task started"]);
});

const case8ABreakingProviderChangeAnd = Effect.gen(function* () {
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  const P1 = remote("t.provider", {
    host: hostNamed("host"),
    input: Type.Object({}),
    variants: { main: { methods: { get: method(undefined, Type.String()) } } },
    version: 1,
  });
  const P2 = remote("t.provider", {
    host: hostNamed("host"),
    input: Type.Object({}),
    variants: { main: { methods: { fetch: method(undefined, Type.String()) } } },
    version: 2,
  });
  const Consumer = local("t.consumer", {
    input: Type.Object({}),
    members: { ask: method(undefined, Type.String()) },
    version: 1,
  });
  host.install({
    name: "both",
    setup: (api) => {
      api.serve(P1, () => ({ get: () => "old", variant: "main" }));
      api.serve(Consumer, (_input, _principal, self) => {
        const provider = self.get(P1, {});
        return { ask: (ctx: chordTypes.Ctx) => provider.get(ctx) };
      });
    },
  });
  const consumer = host.hold(Consumer, {});
  assert.equal(yield* Effect.promise(() => consumer.ask()), "old");
  yield* Effect.promise(() =>
    host.reload([
      {
        name: "both",
        setup: (api) => {
          api.serve(P2, () => ({ fetch: () => "new", variant: "main" }));
          api.serve(Consumer, (_input, _principal, self) => {
            const provider = self.get(P2, {});
            return { ask: (ctx: chordTypes.Ctx) => provider.fetch(ctx) };
          });
        },
      },
    ]),
  );
  assert.equal(yield* Effect.promise(() => consumer.ask()), "new");
});

const Dep = local("t.dep", { input: Type.Object({}), version: 1 });

const retirementFacet =
  (log: string[], services: Context.Context<never>) =>
  (withDecls: boolean): chordTypes.Facet => ({
    name: "item",
    setup: (api) => {
      api.serve(Dep, (_input, _principal, self) => {
        self.resource("r", {
          close: () => void log.push("dep closed"),
          open: () => {},
          version: 1,
        });
        return {};
      });
      api.serve(Item, (_input, _principal, self) => {
        if (withDecls) {
          self.get(Dep, {});
          self.resource("own", {
            close: () =>
              Effect.runPromiseWith(services)(
                Effect.gen(function* () {
                  yield* ticks(3);
                  log.push("own closed");
                }),
              ),
            open: () => {},
            version: 1,
          });
        }
        return { version: () => (withDecls ? "v1" : "v2") };
      });
    },
  });

const case10RetirementClosesDroppedResourcesBefore = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  const log: string[] = [];
  const facet = retirementFacet(log, services);
  host.install(facet(true));
  const ref = host.hold(Item, { id: "a" });
  yield* Effect.promise(() => ref.ready);
  const go = latch();
  const pinned = host.root((ctx) =>
    Effect.runPromiseWith(services)(
      Effect.gen(function* () {
        yield* Effect.promise(() => ref.version(ctx));
        yield* go.wait;
      }),
    ),
  );
  yield* tick;
  yield* Effect.promise(() => host.reload([facet(false)]));
  assert.deepEqual(log, []);
  go.open();
  yield* Effect.promise(() => pinned);
  yield* ticks(20);
  assert.deepEqual(log, ["own closed", "dep closed"]);
});

const Db = local("t.db", {
  input: Type.Object({}),
  members: { read: method(undefined, Type.Unknown()) },
  version: 1,
});

const case7APrepareRerunCannotTouch = Effect.gen(function* () {
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  const native = { mutated: false };
  const facet = (touch: boolean): chordTypes.Facet => ({
    name: "db",
    setup: (api) =>
      api.serve(Db, (_input, _principal, self) => {
        const db = self.resource("db", { open: () => native, version: 1 });
        if (touch) db.value.mutated = true;
        return { read: () => db.value };
      }),
  });
  host.install(facet(false));
  const ref = host.hold(Db, {});
  yield* Effect.promise(() => ref.ready);
  yield* Effect.promise(() =>
    assert.rejects(host.reload([facet(true)]), (error) => isChordError(error, "not_ready")),
  );
  assert.equal(native.mutated, false);
  assert.deepEqual(yield* Effect.promise(() => ref.read()), { mutated: false });
});

const case9ExclusiveResourceAfterCloseFailure = (reopen: "works" | "fails") =>
  Effect.gen(function* () {
    const host = createHost({ onError: () => {}, self: { kind: "host" } });
    const log: string[] = [];
    let opens = 0;
    const facet = (rev: number): chordTypes.Facet => ({
      name: "db",
      setup: (api) =>
        api.serve(Db, (_input, _principal, self) => {
          const port = self.resource("port", {
            close: () => {
              log.push(`close ${rev}`);
              throw new Error("close fails");
            },
            exclusive: true,
            open: () => {
              if (rev === 2) throw new Error("new port fails");
              if (++opens > 1 && reopen === "fails") throw new Error("reopen fails");
              log.push(`open ${rev}`);
              return { rev };
            },
            version: rev,
          });
          return { read: () => port.value };
        }),
    });
    host.install(facet(1));
    const ref = host.hold(Db, {});
    yield* Effect.promise(() => ref.ready);
    yield* Effect.promise(() => assert.rejects(host.reload([facet(2)]), /close fails/u));
    if (reopen === "works") {
      assert.deepEqual(log, ["open 1", "close 1", "open 1"]);
      assert.deepEqual(yield* Effect.promise(() => ref.read()), { rev: 1 });
    } else {
      yield* Effect.promise(() =>
        assert.rejects(ref.read(), (error) => isChordError(error, "unavailable")),
      );
    }
  });

const case9AnExclusiveResourceWhoseClose = Effect.gen(function* () {
  for (const reopen of ["works", "fails"] as const)
    yield* case9ExclusiveResourceAfterCloseFailure(reopen);
});

describe("review: prepare isolation and contracts", () => {
  it("#7 a prepare rerun cannot touch retained resources, even open ones", () =>
    Effect.runPromise(case7APrepareRerunCannotTouch));

  it("#7 objects of types a reload adds start listeners and tasks only at commit", () =>
    Effect.runPromise(case7ObjectsOfTypesAReload));

  it("#8 a breaking provider change and its updated consumer reload in one batch", () =>
    Effect.runPromise(case8ABreakingProviderChangeAnd));

  it("#9 an exclusive resource whose close failed is restored on rollback, or marked unavailable", () =>
    Effect.runPromise(case9AnExclusiveResourceWhoseClose));

  it("#10 retirement closes dropped resources before releasing dropped holds", () =>
    Effect.runPromise(case10RetirementClosesDroppedResourcesBefore));
});
