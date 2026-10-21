import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import chord from "../src/index.ts";
import hostModule from "./fixtures/host.ts";
import timing from "./fixtures/timing.ts";

const { isChordError, local } = chord;

const { Counter, quiet, serveCounter } = hostModule;
const { latch, tick } = timing;

const activatesGoesLiveBindsMembersLate = Effect.gen(function* () {
  const host = quiet();
  const log: string[] = [];
  serveCounter(host, log);
  const ref = host.hold(Counter, { name: "a" });
  assert.equal(ref.status, "loading");
  assert.throws(
    () => ref.count.value,
    (error) => isChordError(error, "not_ready"),
  );
  const pending = ref.add(2);
  yield* Effect.promise(() => ref.ready);
  assert.equal(ref.status, "live");
  assert.equal(yield* Effect.promise(() => pending), 2);
  assert.deepEqual(ref.count.value, { n: 2 });
  ref.release();
  assert.equal(ref.status, "released");
  yield* Effect.promise(() =>
    assert.rejects(ref.add(1), (error) => isChordError(error, "released")),
  );
  yield* tick;
  assert.deepEqual(log, ["factory a", "open a", "close a"]);
});

const coalescesConcurrentGetsAndKeepsThe = Effect.gen(function* () {
  const host = quiet();
  const log: string[] = [];
  serveCounter(host, log);
  const a = host.hold(Counter, { name: "x" });
  const b = host.hold(Counter, { name: "x" });
  yield* Effect.promise(() => Promise.all([a.ready, b.ready]));
  assert.deepEqual(log, ["factory x", "open x"]);
  a.release();
  yield* tick;
  assert.equal(yield* Effect.promise(() => b.add(1)), 1);
  b.release();
  yield* tick;
  assert.deepEqual(log, ["factory x", "open x", "close x"]);
});

const lingersAfterTheLastReleaseAnd = Effect.gen(function* () {
  const host = quiet();
  const log: string[] = [];
  serveCounter(host, log, { linger: 30 });
  const a = host.hold(Counter, { name: "l" });
  yield* Effect.promise(() => a.add(5));
  a.release();
  const b = host.hold(Counter, { name: "l" });
  yield* Effect.promise(() => b.ready);
  assert.deepEqual(b.count.value, { n: 5 });
  b.release();
  yield* Effect.sleep(60);
  assert.deepEqual(log, ["factory l", "open l", "close l"]);
});

const disposesAnAbandonedActivationOnceIt = Effect.gen(function* () {
  const host = quiet();
  const log: string[] = [];
  let release = () => {};
  const Slow = local("t.slow", { input: Type.Object({}), version: 1 });
  host.serve(Slow, (_input, _principal, self) => {
    self.resource("r", {
      close: () => {
        log.push("closed");
      },
      open: ({ signal }) => {
        const gate = latch<string>();
        release = () => gate.open("r");
        signal.addEventListener("abort", () => log.push("abort seen"));
        return gate.promise;
      },
      version: 1,
    });
    return {};
  });
  const ref = host.hold(Slow, {});
  yield* tick;
  ref.release();
  yield* tick;
  release();
  yield* tick;
  yield* tick;
  assert.deepEqual(log, ["abort seen", "closed"]);
  const again = host.hold(Slow, {});
  yield* tick;
  release();
  yield* Effect.promise(() => again.ready);
  assert.equal(again.status, "live");
});

const propagatesActivationFailuresToDependentsAnd = Effect.gen(function* () {
  const host = quiet();
  let fail = true;
  const Leaf = local("t.leaf", { input: Type.Object({}), version: 1 });
  const Parent = local("t.parent", { input: Type.Object({}), version: 1 });
  host.serve(Leaf, (_input, _principal, self) => {
    self.resource("r", {
      open: () => {
        if (fail) throw new Error("boom");
        return 1;
      },
      version: 1,
    });
    return {};
  });
  host.serve(Parent, (_input, _principal, self) => {
    self.get(Leaf, {});
    return {};
  });
  const parent = host.hold(Parent, {});
  yield* Effect.promise(() =>
    assert.rejects(
      parent.ready,
      (error) => isChordError(error, "unavailable") && /boom/u.test(error.message),
    ),
  );
  assert.equal(parent.status, "gone");
  fail = false;
  const retry = host.hold(Parent, {});
  yield* Effect.promise(() => retry.ready);
  assert.equal(retry.status, "live");
});

const unwindsDeclarationsWhenAFactoryThrows = Effect.gen(function* () {
  const host = quiet();
  const Leaf = local("t.leaf2", { input: Type.Object({}), version: 1 });
  const Bad = local("t.bad", { input: Type.Object({ async: Type.Boolean() }), version: 1 });
  let leafLive = 0;
  host.serve(Leaf, (_input, _principal, self) => {
    self.resource("r", {
      close: () => {
        leafLive--;
      },
      open: () => {
        leafLive++;
      },
      version: 1,
    });
    return {};
  });
  host.serve(Bad, ({ async }, _principal, self) => {
    self.get(Leaf, {});
    if (async) return Promise.resolve({}) as never;
    throw new Error("factory failed");
  });
  yield* Effect.promise(() =>
    assert.rejects(host.hold(Bad, { async: false }).ready, /factory failed/u),
  );
  yield* Effect.promise(() =>
    assert.rejects(host.hold(Bad, { async: true }).ready, /synchronous/u),
  );
  yield* tick;
  yield* tick;
  assert.equal(leafLive, 0);
});

const rejectsDuplicateDeclarationNames = Effect.gen(function* () {
  const host = quiet();
  const Dup = local("t.dup", { input: Type.Object({}), version: 1 });
  host.serve(Dup, (_input, _principal, self) => {
    self.state("a", Type.Object({}), {});
    self.state("a", Type.Object({}), {});
    return {};
  });
  yield* Effect.promise(() => assert.rejects(host.hold(Dup, {}).ready, /duplicate state name a/u));
});

const detectsHoldCycles = Effect.gen(function* () {
  const host = quiet();
  const A = local("t.cycle-a", { input: Type.Object({}), version: 1 });
  const B = local("t.cycle-b", { input: Type.Object({}), version: 1 });
  host.serve(A, (_input, _principal, self) => {
    self.get(B, {});
    return {};
  });
  host.serve(B, (_input, _principal, self) => {
    self.get(A, {});
    return {};
  });
  yield* Effect.promise(() => assert.rejects(host.hold(A, {}).ready, /cycle/u));
});

describe("host: activation and lifetime", () => {
  it("activates, goes live, binds members late, disposes after release", () =>
    Effect.runPromise(activatesGoesLiveBindsMembersLate));

  it("coalesces concurrent gets and keeps the object while held", () =>
    Effect.runPromise(coalescesConcurrentGetsAndKeepsThe));

  it("lingers after the last release and revives on a new get", () =>
    Effect.runPromise(lingersAfterTheLastReleaseAnd));

  it("disposes an abandoned activation once it settles", () =>
    Effect.runPromise(disposesAnAbandonedActivationOnceIt));

  it("propagates activation failures to dependents and retries on the next get", () =>
    Effect.runPromise(propagatesActivationFailuresToDependentsAnd));

  it("unwinds declarations when a factory throws and rejects async factories", () =>
    Effect.runPromise(unwindsDeclarationsWhenAFactoryThrows));

  it("rejects duplicate declaration names", () =>
    Effect.runPromise(rejectsDuplicateDeclarationNames));

  it("detects hold cycles", () => Effect.runPromise(detectsHoldCycles));
});
