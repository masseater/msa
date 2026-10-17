import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import { type Ctx, type Facet, isChordError } from "../src/index.ts";
import { CountV1, Greeter, greeterFacet, quiet } from "./fixtures/reload.ts";
import { abortOf, latch, tick } from "./fixtures/timing.ts";

const gateDeadlineReloadAbortsReportsBlocking = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const host = quiet();
  const log: string[] = [];
  const facet = (greeting: string, version: number): Facet => ({
    name: "greeter",
    setup: (api) =>
      api.serve(Greeter, (_input, _principal, self) => {
        self.task((ctx) =>
          Effect.runPromiseWith(services)(
            Effect.gen(function* () {
              log.push(`start ${greeting}`);
              yield* abortOf(ctx.signal);
              log.push(`stop ${greeting}`);
            }),
          ),
        );
        const count = self.state("count", Type.Number(), 0, { version });
        return { count, greet: (name: string) => `${greeting} ${name}` };
      }),
  });
  host.install(facet("hello", 1));
  const ref = host.hold(Greeter, {});
  yield* Effect.promise(() => ref.ready);
  const go = latch();
  const blocker = host.root((ctx) =>
    Effect.runPromiseWith(services)(
      Effect.gen(function* () {
        yield* Effect.promise(() => ref.greet("b", ctx));
        yield* go.wait;
      }),
    ),
  );
  yield* tick;
  yield* Effect.promise(() =>
    assert.rejects(host.reload([facet("hi", 2)], { gateDeadline: 30 }), (error) => {
      assert.ok(isChordError(error, "aborted") && error.reason === "gate_deadline");
      assert.match(error.message, /blocking roots: host#\w+:\d+/u);
      return true;
    }),
  );
  assert.equal(yield* Effect.promise(() => ref.greet("x")), "hello x");
  yield* tick;
  assert.deepEqual(log, ["start hello", "stop hello", "start hello"]);
  go.open();
  yield* Effect.promise(() => blocker);
});

const exclusiveResourcesAreReplacedAtThe = Effect.gen(function* () {
  const host = quiet();
  const log: string[] = [];
  const facet = (rev: number): Facet => ({
    name: "greeter",
    setup: (api) =>
      api.serve(Greeter, (_input, _principal, self) => {
        const lock = self.resource("lock", {
          version: rev,
          exclusive: true,
          open: () => {
            log.push(`open lock ${rev}`);
            return rev;
          },
          close: () => void log.push(`close lock ${rev}`),
        });
        self.resource("cache", {
          version: rev,
          open: () => void log.push(`open cache ${rev}`),
          close: () => void log.push(`close cache ${rev}`),
        });
        const count = self.state("count", Type.Number(), 0);
        return { count, greet: (name: string) => `${lock.value} ${name}` };
      }),
  });
  host.install(facet(1));
  const ref = host.hold(Greeter, {});
  assert.equal(yield* Effect.promise(() => ref.greet("x")), "1 x");
  log.length = 0;
  const report = yield* Effect.promise(() => host.reload([facet(2)]));
  assert.equal(report.gated.length, 1);
  assert.equal(yield* Effect.promise(() => ref.greet("x")), "2 x");
  yield* tick;
  assert.deepEqual(log, ["open cache 2", "close lock 1", "open lock 2", "close cache 1"]);
});

const twoVersionRuleTheNextReload = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const host = quiet();
  host.install(greeterFacet({ greeting: "v1" }));
  const ref = host.hold(Greeter, {});
  yield* Effect.promise(() => ref.ready);
  const first = host.codeVersion;
  const go = latch();
  const pinned = host.root((ctx) =>
    Effect.runPromiseWith(services)(
      Effect.gen(function* () {
        yield* Effect.promise(() => ref.greet("p", ctx));
        yield* go.wait;
        return yield* Effect.promise(() => ref.greet("p", ctx));
      }),
    ),
  );
  yield* tick;
  yield* Effect.promise(() => host.reload([greeterFacet({ greeting: "v2" })]));
  assert.equal(host.previousCodeVersion, first);
  yield* Effect.promise(() =>
    host.reload([greeterFacet({ greeting: "v3" })], { retireDeadline: 20 }),
  );
  go.open();
  yield* Effect.promise(() =>
    assert.rejects(pinned, (error) => isChordError(error, "superseded") && error.retryable),
  );
  yield* Effect.promise(() =>
    assert.rejects(
      host.root(() => 1, { codeVersion: first }),
      (error) => isChordError(error, "superseded"),
    ),
  );
  assert.equal(yield* Effect.promise(() => ref.greet("n")), "v3 n");
});

const forcedRetirementAbortsTheLeftoverRoots = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const host = quiet();
  const log: string[] = [];
  const hold = latch();
  const facet = (version: number): Facet => ({
    name: "greeter",
    setup: (api) =>
      api.serve(Greeter, (_input, _principal, self) => {
        const conn = self.resource("conn", {
          version,
          open: () => ({ version }),
          close: () => void log.push(`close ${version}`),
        });
        const count = self.state("count", CountV1, { n: 0 });
        return {
          count,
          greet: (name: string, ctx: Ctx) =>
            Effect.runPromiseWith(services)(
              Effect.gen(function* () {
                if (name === "hold") {
                  yield* hold.wait;
                  return `held on ${conn.value.version}, aborted ${ctx.signal.aborted}`;
                }
                if (name !== "wait") return name;
                yield* abortOf(ctx.signal);
                log.push(`aborted, conn ${conn.value.version}`);
                return name;
              }),
            ),
        };
      }),
  });
  host.install(facet(1));
  const ref = host.hold(Greeter, {});
  yield* Effect.promise(() => ref.ready);
  const old = host.root((ctx) => ref.greet("wait", ctx));
  yield* tick;
  yield* Effect.promise(() => host.reload([facet(2)]));
  const current = host.root((ctx) => ref.greet("hold", ctx));
  yield* tick;
  yield* Effect.promise(() => host.reload([facet(3)], { retireDeadline: 20 }));
  assert.equal(yield* Effect.promise(() => old), "wait");
  for (let i = 0; i < 50 && !log.includes("close 1"); i++) yield* tick;
  assert.deepEqual(log, ["aborted, conn 1", "close 1"]);
  hold.open();
  assert.equal(yield* Effect.promise(() => current), "held on 2, aborted false");
  assert.equal(yield* Effect.promise(() => ref.greet("x")), "x");
});

const aKeptResourceClosesWithThe = Effect.gen(function* () {
  const host = quiet();
  const log: string[] = [];
  const facet = (label: string): Facet => ({
    name: "greeter",
    setup: (api) =>
      api.serve(Greeter, (_input, _principal, self) => {
        self.resource("conn", {
          version: 1,
          open: () => ({}),
          close: () => void log.push(`close by ${label}`),
        });
        const count = self.state("count", CountV1, { n: 0 });
        return { count, greet: (name: string) => `${label} ${name}` };
      }),
  });
  host.install(facet("a"));
  const ref = host.hold(Greeter, {});
  yield* Effect.promise(() => ref.ready);
  yield* Effect.promise(() => host.reload([facet("b")]));
  yield* Effect.promise(() => host.reload([facet("c")]));
  assert.equal(yield* Effect.promise(() => ref.greet("x")), "c x");
  assert.deepEqual(log, [], "kept, not reopened");
  ref.release();
  for (let i = 0; i < 10 && log.length === 0; i++) yield* tick;
  assert.deepEqual(log, ["close by c"]);
});

describe("reload", () => {
  it("gate deadline: reload aborts, reports blocking roots, nothing changes", () =>
    Effect.runPromise(gateDeadlineReloadAbortsReportsBlocking));

  it("exclusive resources are replaced at the gate; non-exclusive ones at prepare and closed at retirement", () =>
    Effect.runPromise(exclusiveResourcesAreReplacedAtThe));

  it("two-version rule: the next reload retires the previous code version; its roots get superseded", () =>
    Effect.runPromise(twoVersionRuleTheNextReload));

  it("forced retirement aborts the leftover roots before it closes the resources only their code used", () =>
    Effect.runPromise(forcedRetirementAbortsTheLeftoverRoots));

  it("a kept resource closes with the newest declaration's close", () =>
    Effect.runPromise(aKeptResourceClosesWithThe));
});
