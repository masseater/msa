import assert from "node:assert/strict";

import { type Context, Effect } from "effect";
import { Type } from "typebox";
import { describe, it, onTestFinished, vi } from "vite-plus/test";

import chord from "../src/index.ts";
import type chordTypes from "../src/index.types.ts";
import reloadModule from "./fixtures/reload.ts";
import timing from "./fixtures/timing.ts";

const { createHost, hostNamed, isChordError, local, method, remote } = chord;

const { CountV1, Greeter, quiet } = reloadModule;
const { abortOf, latch, tick } = timing;

const aTaskThatIgnoresItsAbort = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const errors: unknown[] = [];
  const host = createHost({
    onError: (error) => errors.push(error),
    self: { kind: "host" },
    taskStopDeadline: 30,
  });
  const log: string[] = [];
  const stuck = latch();
  const facet = (label: string): chordTypes.Facet => ({
    name: "greeter",
    setup: (api) =>
      api.serve(Greeter, (_input, _principal, self) => {
        self.task(() =>
          Effect.runPromiseWith(services)(
            Effect.gen(function* () {
              log.push(`start ${label}`);
              if (label === "a") yield* stuck.wait;
            }),
          ),
        );
        const count = self.state("count", CountV1, { n: 0 });
        return { count, greet: (name: string) => name };
      }),
  });
  host.install(facet("a"));
  const ref = host.hold(Greeter, {});
  yield* Effect.promise(() => ref.ready);
  yield* Effect.promise(() => host.reload([facet("b")]));
  yield* Effect.promise(() => vi.advanceTimersByTimeAsync(29));
  yield* tick;
  assert.deepEqual(log, ["start a"], "waits for the old run");
  assert.equal(errors.length, 0);
  yield* Effect.promise(() => vi.advanceTimersByTimeAsync(1));
  yield* tick;
  assert.deepEqual(log, ["start a", "start b"]);
  assert.ok(
    errors.some(
      (error) => isChordError(error, "aborted") && /still running after 30 ms/u.test(error.message),
    ),
  );
  stuck.open();
});

const aFacetSSignalAbortsWhen = Effect.gen(function* () {
  const host = quiet();
  const signals = new Map<string, AbortSignal>();
  const facet = (label: string, fail = false): chordTypes.Facet => ({
    name: "greeter",
    setup: (api) => {
      signals.set(label, api.signal);
      api.serve(Greeter, (_input, _principal, self) => {
        if (fail) throw new Error("broken");
        const count = self.state("count", CountV1, { n: 0 });
        return { count, greet: (name: string) => name };
      });
    },
  });
  const other: chordTypes.Facet = {
    name: "other",
    setup: (api) => void signals.set("other", api.signal),
  };
  host.install(facet("a"));
  host.install(other);
  yield* Effect.promise(() => host.hold(Greeter, {}).ready);
  yield* Effect.promise(() => assert.rejects(host.reload([facet("b", true)])));
  assert.equal(signals.get("b")?.aborted, true, "the aborted reload's run");
  assert.equal(signals.get("a")?.aborted, false, "still installed");
  yield* Effect.promise(() => host.reload([facet("c")]));
  assert.equal(signals.get("a")?.aborted, true, "replaced");
  assert.equal(signals.get("c")?.aborted, false);
  yield* Effect.promise(() => host.reload([], { remove: ["other"] }));
  assert.equal(signals.get("other")?.aborted, true, "removed");
  yield* Effect.promise(() => host.close());
  assert.equal(signals.get("c")?.aborted, true, "host closed");
});

const DocV1 = remote("t.rdoc", {
  host: hostNamed("host"),
  input: Type.Object({}),
  variants: {
    main: { methods: { read: method(undefined, Type.Object({ text: Type.String() })) } },
  },
  version: 1,
});

const DocBroken = remote("t.rdoc", {
  host: hostNamed("host"),
  input: Type.Object({}),
  variants: {
    main: { methods: { read: method(undefined, Type.Object({ text: Type.Number() })) } },
  },
  version: 1,
});

const DocV2 = remote("t.rdoc", {
  host: hostNamed("host"),
  input: Type.Object({}),
  variants: {
    main: { methods: { fetch: method(undefined, Type.Object({ body: Type.String() })) } },
  },
  version: 2,
});

const checksContractsAtReloadForgottenBumps = Effect.gen(function* () {
  const host = quiet();
  host.install({
    name: "doc",
    setup: (api) => api.serve(DocV1, () => ({ read: () => ({ text: "v1" }), variant: "main" })),
  });
  const consumer = host.hold(DocV1, {});
  assert.deepEqual(yield* Effect.promise(() => consumer.read()), { text: "v1" });

  const broken: chordTypes.Facet = {
    name: "doc",
    setup: (api) => api.serve(DocBroken, () => ({ read: () => ({ text: 1 }), variant: "main" })),
  };
  yield* Effect.promise(() => assert.rejects(host.reload([broken]), /without a version bump/u));

  const fetch = () => ({ body: "v2" });
  const v2: chordTypes.Facet = {
    name: "doc",
    setup: (api) => api.serve(DocV2, () => ({ fetch, variant: "main" })),
  };
  yield* Effect.promise(() =>
    assert.rejects(host.reload([v2]), (error) => isChordError(error, "contract_mismatch")),
  );

  const adapted: chordTypes.Facet = {
    name: "doc",
    setup: (api) =>
      api.serve(DocV2, () => ({ fetch, variant: "main" }), {
        accepts: {
          1: (current) => ({
            read: () => ({
              text: `${(current["fetch"] as typeof fetch)().body} via adapter`,
            }),
            variant: "main",
          }),
        },
      }),
  };
  yield* Effect.promise(() => host.reload([adapted]));
  assert.deepEqual(yield* Effect.promise(() => consumer.read()), { text: "v2 via adapter" });
  const modern = host.hold(DocV2, {});
  assert.deepEqual(yield* Effect.promise(() => modern.fetch()), { body: "v2" });
});

const Sum = local("t.sum", {
  input: Type.Object({}),
  members: { sum: Type.Object({ v: Type.Number() }) },
  version: 1,
});

interface NumberEvents {
  readonly subscribe: (fn: (event: number) => void) => () => boolean;
}

const summingFacet = (
  events: NumberEvents,
  log: string[],
  services: Context.Context<never>,
): ((factor: number) => chordTypes.Facet) => {
  const facet = (factor: number): chordTypes.Facet => ({
    name: "sum",
    setup: (api) =>
      api.serve(Sum, (_input, _principal, self) => {
        const sum = self.state("sum", Type.Object({ v: Type.Number() }), { v: 0 });
        self.on(
          "add",
          events,
          (source) => source,
          (value, ctx) =>
            sum.change(ctx, (draft) => {
              draft.v += value * factor;
            }),
        );
        self.task((ctx) =>
          Effect.runPromiseWith(services)(
            Effect.gen(function* () {
              log.push(`start ${factor}`);
              yield* abortOf(ctx.signal);
              log.push(`stop ${factor}`);
            }),
          ),
        );
        return { sum };
      }),
  });
  return facet;
};

const rebindsListenersToTheNewCode = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const host = quiet();
  const listeners = new Set<(event: number) => void>();
  const events = {
    subscribe: (fn: (event: number) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  const emit = (value: number) => {
    for (const fn of listeners) fn(value);
  };
  const log: string[] = [];
  const facet = summingFacet(events, log, services);
  host.install(facet(1));
  const ref = host.hold(Sum, {});
  yield* Effect.promise(() => ref.ready);
  emit(1);
  yield* tick;
  yield* Effect.promise(() => host.reload([facet(10)]));
  assert.equal(listeners.size, 1);
  emit(1);
  yield* tick;
  assert.deepEqual(ref.sum.value, { v: 11 });
  assert.deepEqual(log, ["start 1", "stop 1", "start 10"]);
});

describe("reload", () => {
  it("a task that ignores its abort delays its replacement at most taskStopDeadline (reported)", () =>
    Effect.runPromise(aTaskThatIgnoresItsAbort));

  it("a facet's signal aborts when its run is replaced or removed, when its reload aborts, and when the host closes", () =>
    Effect.runPromise(aFacetSSignalAbortsWhen));

  it("checks contracts at reload: forgotten bumps, live consumers, accepts adapters", () =>
    Effect.runPromise(checksContractsAtReloadForgottenBumps));

  it("rebinds listeners to the new code and restarts tasks", () =>
    Effect.runPromise(rebindsListenersToTheNewCode));
});
