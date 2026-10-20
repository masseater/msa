import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import { type Facet, isChordError, local, method } from "../src/index.ts";
import hostModule from "./fixtures/host.ts";
import timing from "./fixtures/timing.ts";

const { Counter, quiet, serveCounter, until } = hostModule;
const { tick } = timing;

const closesResourcesInReverseOrderRuns = Effect.gen(function* () {
  const errors: unknown[] = [];
  const host = quiet(errors);
  const log: string[] = [];
  const Multi = local("t.multi", { input: Type.Object({}), version: 1 });
  host.serve(Multi, (_input, _principal, self) => {
    const a = self.resource("a", {
      close: () => void log.push("close a"),
      open: () => "a",
      version: 1,
    });
    self.resource("b", {
      close: () => {
        log.push("close b");
        throw new Error("b failed");
      },
      deps: [a],
      open: () => "b",
      version: 1,
    });
    self.resource("c", {
      close: () => {
        log.push("close c");
        throw new Error("c failed");
      },
      open: () => "c",
      version: 1,
    });
    return {};
  });
  const ref = host.hold(Multi, {});
  yield* Effect.promise(() => ref.ready);
  ref.release();
  yield* tick;
  yield* tick;
  assert.equal(log.at(-1), "close a");
  assert.equal(log.length, 3);
  assert.ok(errors[0] instanceof AggregateError);
  assert.equal((errors[0] as AggregateError).errors.length, 2);
});

const releasesCtxGetHoldsWhenThe = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const host = quiet();
  const log: string[] = [];
  serveCounter(host, log);
  const value = yield* Effect.promise(() =>
    host.root((ctx) =>
      Effect.runPromiseWith(services)(
        Effect.gen(function* () {
          const counter = yield* Effect.promise(() => ctx.get(Counter, { name: "c" }));
          return yield* Effect.promise(() => counter.add(3, ctx));
        }),
      ),
    ),
  );
  assert.equal(value, 3);
  yield* tick;
  assert.deepEqual(log, ["factory c", "open c", "close c"]);
});

describe("host: activation and lifetime", () => {
  it("closes resources in reverse order, runs all steps and aggregates errors", () =>
    Effect.runPromise(closesResourcesInReverseOrderRuns));

  it("releases ctx.get holds when the call settles", () =>
    Effect.runPromise(releasesCtxGetHoldsWhenThe));
});

const refusesASecondDeclarationOfOne = Effect.gen(function* () {
  const host = quiet();
  const Twice = local("t.twice", { input: Type.Object({ kind: Type.String() }), version: 1 });
  host.serve(Twice, ({ kind }, _principal, self) => {
    const open = { open: () => null, version: 1 };
    self.state("x", Type.Number(), 0);
    self.resource("x", open);
    self.on("x", self.state("y", Type.Number(), 0), () => {});
    if (kind === "state") self.state("x", Type.Number(), 1);
    if (kind === "resource") self.resource("x", open);
    if (kind === "listener") self.on("x", self.state("z", Type.Number(), 0), () => {});
    return {};
  });
  yield* Effect.promise(() => host.hold(Twice, { kind: "none" }).ready);
  for (const kind of ["state", "resource", "listener"]) {
    yield* Effect.promise(() =>
      assert.rejects(
        host.hold(Twice, { kind }).ready,
        (error) =>
          isChordError(error, "invalid") &&
          error.reason === "duplicate" &&
          error.message.includes(`${kind} name x`),
      ),
    );
  }
});

const methodsWithoutArgumentsAreCalledWith = Effect.gen(function* () {
  const host = quiet();
  const Tool = local("t.tool", {
    input: Type.Object({}),
    members: {
      count: method(undefined, Type.Number()),
      note: method(Type.String()),
      ping: method(),
    },
    version: 1,
  });
  const seen: unknown[] = [];
  host.serve(Tool, () => ({
    count: () => 3,
    note: (text, ctx) => {
      seen.push(text, typeof ctx.rootId);
    },
    ping: (ctx) => {
      seen.push(typeof ctx.rootId);
      return "ignored" as never;
    },
  }));
  const tool = host.hold(Tool, {});
  yield* Effect.promise(() => tool.ready);
  assert.equal(yield* Effect.promise(() => tool.ping()), undefined);
  assert.equal(yield* Effect.promise(() => host.root((ctx) => tool.count(ctx))), 3);
  assert.equal(yield* Effect.promise(() => tool.note("hi")), undefined);
  assert.deepEqual(seen, ["string", "hi", "string"]);
});

const aListenerOnStateGetsThe = Effect.gen(function* () {
  const host = quiet();
  const Doubled = local("t.doubled", {
    input: Type.Object({}),
    members: { set: method(Type.Number()) },
    version: 1,
  });
  const seen: number[] = [];
  const facet = (label: string): Facet => ({
    name: "doubled",
    setup: (api) =>
      api.serve(
        Doubled,
        (_input, _principal, self) => {
          const n = self.state("n", Type.Number(), 1);
          const doubled = self.derive([n], (value) => value * 2);
          self.on("doubled", doubled, (value) => {
            seen.push(value);
            void label;
          });
          return {
            set: (value, ctx) => {
              n.replace(ctx, value);
            },
          };
        },
        { lifetime: "host" },
      ),
  });
  yield* Effect.promise(() => host.install(facet("v1")));
  yield* until(() => seen.length === 1);
  yield* Effect.promise(() => host.root((ctx) => host.hold(Doubled, {}).set(5, ctx)));
  yield* until(() => seen.length === 2);
  assert.deepEqual(seen, [2, 10]);
  yield* Effect.promise(() => host.reload([facet("v2")]));
  yield* until(() => seen.length === 3);
  yield* tick;
  assert.deepEqual(seen, [2, 10, 10]);
});

describe("host: declarations and methods", () => {
  it("refuses a second declaration of one name per kind; kinds have their own names", () =>
    Effect.runPromise(refusesASecondDeclarationOfOne));

  it("methods without arguments are called with ctx alone; void methods resolve to undefined", () =>
    Effect.runPromise(methodsWithoutArgumentsAreCalledWith));

  it("a listener on state gets the current value at start and again after a reload replaced its derivation", () =>
    Effect.runPromise(aListenerOnStateGetsThe));
});
