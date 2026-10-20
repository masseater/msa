import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import chord from "../src/index.ts";
import type chordTypes from "../src/index.types.ts";
import reloadModule from "./fixtures/reload.ts";
import timing from "./fixtures/timing.ts";

const { defineRegistry, isChordError, local, method } = chord;

const { CountV1, Greeter, greeterFacet, quiet, until } = reloadModule;
const { latch, tick } = timing;

const keepsRegistryTablesPerCodeVersion = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const host = quiet();
  const Routes = defineRegistry<string>("t.reload-routes");
  const Router = local("t.router", { input: Type.Object({}), version: 1 });
  const facet = (value: string): chordTypes.Facet => ({
    name: "router",
    setup: (api) =>
      api.serve(
        Router,
        (_input, _principal, self) => {
          self.register(Routes, { "GET /": value });
          return {};
        },
        { lifetime: "host" },
      ),
  });
  host.install(facet("one"));
  yield* tick;
  yield* tick;
  const seen: [string | undefined, number][] = [];
  host
    .registry(Routes)
    .subscribe((table, codeVersion) => seen.push([table.get("GET /"), codeVersion]));
  const go = latch();
  const pinned = host.root((ctx) =>
    Effect.runPromiseWith(services)(
      Effect.gen(function* () {
        yield* go.wait;
        return host.registry(Routes).get("GET /", ctx);
      }),
    ),
  );
  const report = yield* Effect.promise(() => host.reload([facet("two")]));
  assert.equal(host.registry(Routes).get("GET /"), "two");
  go.open();
  assert.equal(yield* Effect.promise(() => pinned), "one");
  assert.deepEqual(seen, [
    ["one", report.previous],
    ["two", report.codeVersion],
  ]);
});

const aReloadCanAddAType = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const host = quiet();
  host.install(greeterFacet({ greeting: "hello" }));
  const ref = host.hold(Greeter, {});
  yield* Effect.promise(() => ref.ready);
  const Clock = local("t.clock", {
    input: Type.Object({}),
    members: { now: method(undefined, Type.Number()) },
    version: 1,
  });
  const clockFacet: chordTypes.Facet = {
    name: "clock",
    setup: (api) => api.serve(Clock, () => ({ now: () => 42 })),
  };
  const consumer = (fail: boolean): chordTypes.Facet => ({
    name: "greeter",
    setup: (api) =>
      api.serve(Greeter, (_input, _principal, self) => {
        const clock = self.get(Clock, {});
        const count = self.state("count", CountV1, { n: 0 });
        if (fail) throw new Error("consumer fails");
        return {
          count,
          greet: (name: string, ctx: chordTypes.Ctx) =>
            Effect.runPromiseWith(services)(
              Effect.gen(function* () {
                return `${yield* Effect.promise(() => clock.now(ctx))} ${name}`;
              }),
            ),
        };
      }),
  });
  const codeVersion = host.codeVersion;
  yield* Effect.promise(() =>
    assert.rejects(host.reload([clockFacet, consumer(true)]), /consumer fails/u),
  );
  assert.equal(host.codeVersion, codeVersion);
  assert.equal(yield* Effect.promise(() => ref.greet("x")), "hello x");
  yield* Effect.promise(() => host.reload([clockFacet, consumer(false)]));
  assert.equal(yield* Effect.promise(() => ref.greet("x")), "42 x");
});

const theGateRejectsNewObjectsOf = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const host = quiet();
  host.install(greeterFacet({ greeting: "hello" }));
  const ref = host.hold(Greeter, {});
  yield* Effect.promise(() => ref.ready);
  const go = latch();
  const grandfathered = host.root((ctx) =>
    Effect.runPromiseWith(services)(
      Effect.gen(function* () {
        yield* Effect.promise(() => ref.greet("g", ctx));
        yield* go.wait;
      }),
    ),
  );
  const later = latch();
  const pinned = host.root((ctx) =>
    Effect.runPromiseWith(services)(
      Effect.gen(function* () {
        yield* later.wait;
        return yield* Effect.promise(() => ref.greet("old", ctx));
      }),
    ),
  );
  yield* tick;
  const reload = host.reload([greeterFacet({ greeting: "hi", state: { version: 2 } })]);
  yield* until(() =>
    ref.greet("probe").then(
      () => false,
      (error: unknown) => isChordError(error, "upgrade_conflict"),
    ),
  );
  assert.throws(
    () => host.hold(Greeter, { id: "late" }),
    (error) => isChordError(error, "upgrade_conflict") && error.retryable,
  );
  go.open();
  yield* Effect.promise(() => grandfathered);
  yield* Effect.promise(() => reload);
  assert.equal(yield* Effect.promise(() => host.hold(Greeter, { id: "late" }).greet("l")), "hi l");
  assert.notEqual(host.previousCodeVersion, undefined);
  later.open();
  yield* Effect.promise(() =>
    assert.rejects(pinned, (error) => isChordError(error, "upgrade_conflict")),
  );
});

describe("reload", () => {
  it("keeps registry tables per code version", () =>
    Effect.runPromise(keepsRegistryTablesPerCodeVersion));

  it("a reload can add a type together with a consumer that holds it", () =>
    Effect.runPromise(aReloadCanAddAType));

  it("the gate rejects new objects of a changed type; after commit they get the new code", () =>
    Effect.runPromise(theGateRejectsNewObjectsOf));
});
