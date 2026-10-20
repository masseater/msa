import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import chord from "../src/index.ts";
import type chordTypes from "../src/index.types.ts";
import reloadModule from "./fixtures/reload.ts";
import timing from "./fixtures/timing.ts";

const { isChordError, local, method } = chord;

const { Greeter, greeterFacet, quiet, until } = reloadModule;
const { latch, tick } = timing;

const compatibleReloadNoGatePinnedRoots = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const host = quiet();
  host.install(greeterFacet({ greeting: "hello" }));
  const ref = host.hold(Greeter, {});
  assert.equal(yield* Effect.promise(() => ref.greet("a")), "hello a");
  const go = latch();
  const pinned = host.root((ctx) =>
    Effect.runPromiseWith(services)(
      Effect.gen(function* () {
        const first = yield* Effect.promise(() => ref.greet("p", ctx));
        yield* go.wait;
        return [first, yield* Effect.promise(() => ref.greet("p", ctx))];
      }),
    ),
  );
  yield* tick;
  const shapes: string[] = [];
  ref.onShape((shape) => shapes.push(shape.contract));
  const report = yield* Effect.promise(() => host.reload([greeterFacet({ greeting: "hi" })]));
  assert.deepEqual(report.gated, []);
  assert.equal(report.prepared.length, 1);
  assert.equal(yield* Effect.promise(() => ref.greet("b")), "hi b");
  assert.equal(shapes.length, 1, "one shape push at the commit");
  assert.equal(host.previousCodeVersion, report.previous);
  go.open();
  assert.deepEqual(yield* Effect.promise(() => pinned), ["hello p", "hello p"]);
  assert.equal(host.previousCodeVersion, undefined);
  assert.deepEqual(ref.count.value, { n: 4 });
});

const prepareRunsInRecordingModeWrites = Effect.gen(function* () {
  const host = quiet();
  host.install(greeterFacet({ greeting: "hello" }));
  const a = host.hold(Greeter, { id: "a" });
  const b = host.hold(Greeter, { id: "b" });
  yield* Effect.promise(() => Promise.all([a.ready, b.ready]));
  let captured: chordTypes.Ctx | undefined;
  yield* Effect.promise(() =>
    host.root((ctx) => {
      captured = ctx;
    }),
  );

  const writing = greeterFacet({
    extra: (self) => {
      const probe = self.state("probe", Type.Object({}), {});
      probe.replace(captured!, {});
    },
    greeting: "hi",
  });
  yield* Effect.promise(() => assert.rejects(host.reload([writing]), /read_only/u));

  const log: string[] = [];
  const failing = greeterFacet({
    extra: (self, input) => {
      self.resource("extra", {
        close: () => void log.push(`close ${input.id}`),
        open: () => void log.push(`open ${input.id}`),
        version: 1,
      });
      if (input.id === "b") throw new Error("b fails");
    },
    greeting: "hi",
  });
  const codeVersion = host.codeVersion;
  yield* Effect.promise(() =>
    assert.rejects(
      host.reload([failing]),
      (error) =>
        isChordError(error, "unavailable") && /reload aborted.*b fails/u.test(error.message),
    ),
  );
  assert.equal(host.codeVersion, codeVersion);
  assert.deepEqual(log, ["open a", "close a"]);
  assert.equal(yield* Effect.promise(() => a.greet("x")), "hello x");
});

const refusesAChangedCellSchemaWithout = Effect.gen(function* () {
  const host = quiet();
  host.install(greeterFacet({ greeting: "hello" }));
  yield* Effect.promise(() => host.hold(Greeter, {}).ready);
  const changed = greeterFacet({
    greeting: "hi",
    initial: { total: 0 },
    schema: Type.Object({ total: Type.Number() }),
  });
  yield* Effect.promise(() =>
    assert.rejects(
      host.reload([changed]),
      (error) =>
        isChordError(error, "invalid") &&
        error.reason === "state" &&
        /without a version bump/u.test(error.message),
    ),
  );
});

const stateBumpGateMigrateOldFromversion = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const host = quiet();
  host.install(greeterFacet({ greeting: "hello" }));
  const ref = host.hold(Greeter, {});
  yield* Effect.promise(() => ref.greet("a"));
  yield* Effect.promise(() => ref.greet("a"));
  const events: chordTypes.StateEvent<unknown>[] = [];
  ref.count.events((event) => events.push(event));
  const go = latch();
  const late = host.root((ctx) =>
    Effect.runPromiseWith(services)(
      Effect.gen(function* () {
        yield* go.wait;
        return yield* Effect.promise(() => ref.greet("late", ctx));
      }),
    ),
  );
  const froms: number[] = [];
  const v2 = greeterFacet({
    bump: (draft) => {
      draft["total"] = (draft["total"] ?? 0) + 1;
    },
    greeting: "hi",
    initial: { total: 0 },
    schema: Type.Object({ total: Type.Number() }),
    state: {
      migrate: (old, from) => {
        froms.push(from);
        return { total: (old as { n: number }).n } as never;
      },
      version: 2,
    },
  });
  const report = yield* Effect.promise(() => host.reload([v2]));
  assert.equal(report.gated.length, 1);
  assert.deepEqual(froms, [1]);
  assert.deepEqual(events.at(-1), { type: "reset", value: { total: 2 } });
  assert.equal(yield* Effect.promise(() => ref.greet("b")), "hi b");
  assert.deepEqual(ref.count.value, { total: 3 });
  go.open();
  yield* Effect.promise(() =>
    assert.rejects(late, (error) => isChordError(error, "upgrade_conflict") && error.retryable),
  );
});

const versionsArePerCellARaised = Effect.gen(function* () {
  const host = quiet();
  const Pair = local("t.pair", {
    input: Type.Object({}),
    members: { a: Type.Unknown(), b: Type.Unknown(), bump: method() },
    version: 1,
  });
  const migrated: string[] = [];
  const facet = (version: number): chordTypes.Facet => ({
    name: "pair",
    setup: (api) =>
      api.serve(Pair, (_input, _principal, self) => {
        const a = self.state("a", Type.Number(), 1);
        const b = self.state("b", Type.Number(), 1, {
          migrate: (old, from) => {
            migrated.push(`b ${from}->${version}`);
            return (old as number) * 10;
          },
          version,
        });
        return {
          a,
          b,
          bump: (ctx) => {
            a.replace(ctx, a.value + 1);
          },
        };
      }),
  });
  host.install(facet(1));
  const pair = host.hold(Pair, {});
  yield* Effect.promise(() => pair.ready);
  yield* Effect.promise(() => pair.bump());
  const report = yield* Effect.promise(() => host.reload([facet(2)]));
  assert.equal(report.gated.length, 1);
  assert.deepEqual(migrated, ["b 1->2"]);
  assert.deepEqual([pair.a.value, pair.b.value], [2, 10], "a kept as it was, b migrated");
  yield* Effect.promise(() =>
    assert.rejects(host.reload([facet(1)]), /version of state b lowered from 2 to 1/u),
  );
});

const gateLateOldRootsGetUpgrade = Effect.gen(function* () {
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
        return yield* Effect.promise(() => ref.greet("g", ctx));
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
  go.open();
  assert.equal(yield* Effect.promise(() => grandfathered), "hello g");
  const report = yield* Effect.promise(() => reload);
  assert.equal(report.gated.length, 1);
  assert.equal(yield* Effect.promise(() => ref.greet("n")), "hi n");
});

describe("reload", () => {
  it("compatible reload: no gate, pinned roots keep old code, state preserved, previous retires", () =>
    Effect.runPromise(compatibleReloadNoGatePinnedRoots));

  it("prepare runs in recording mode: writes throw and a failing factory leaves everything unchanged", () =>
    Effect.runPromise(prepareRunsInRecordingModeWrites));

  it("refuses a changed cell schema without a version bump", () =>
    Effect.runPromise(refusesAChangedCellSchemaWithout));

  it("state bump: gate, migrate(old, fromVersion) into the new schema, reset to watchers, old roots upgrade_conflict", () =>
    Effect.runPromise(stateBumpGateMigrateOldFromversion));

  it("versions are per cell: a raised one migrates only that cell, a lowered one is refused", () =>
    Effect.runPromise(versionsArePerCellARaised));

  it("gate: late old roots get upgrade_conflict, grandfathered roots re-enter, then commit", () =>
    Effect.runPromise(gateLateOldRootsGetUpgrade));
});
