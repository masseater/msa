import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it, onTestFinished, vi } from "vite-plus/test";

import {
  type Ctx,
  createHost,
  defineRegistry,
  type Facet,
  hostNamed,
  isChordError,
  local,
  method,
  remote,
  type Self,
  type ServeOptions,
  type StateEvent,
  type StateOptions,
} from "../src/index.ts";
import { abortOf, latch, tick } from "./fixtures/timing.ts";

const quiet = () => createHost({ self: { kind: "host" }, onError: () => {} });

const Greeter = local("t.greeter", {
  version: 1,
  input: Type.Object({ id: Type.Optional(Type.String({ default: "a" })) }),
  members: { greet: method(Type.String(), Type.String()), count: Type.Unknown() },
});

const CountV1 = Type.Object({ n: Type.Number() });

interface GreeterSpec {
  readonly greeting: string;
  readonly schema?: typeof CountV1 | ReturnType<typeof Type.Object>;
  readonly initial?: object;
  readonly bump?: (draft: Record<string, number>) => void;
  readonly options?: ServeOptions;
  readonly state?: StateOptions<never>;
  readonly extra?: (self: Self, input: { id?: string }) => void;
}

function greeterFacet(spec: GreeterSpec): Facet {
  return {
    name: "greeter",
    setup: (api) =>
      api.serve(
        Greeter,
        (input, _principal, self) => {
          spec.extra?.(self, input);
          const count = self.state(
            "count",
            spec.schema ?? CountV1,
            (spec.initial ?? { n: 0 }) as never,
            spec.state,
          );
          return {
            count,
            greet: (name: string, ctx: Ctx) => {
              count.change(ctx, (draft) => {
                const bump =
                  spec.bump ??
                  ((d: Record<string, number>) => {
                    d["n"] = (d["n"] ?? 0) + 1;
                  });
                bump(draft as Record<string, number>);
              });
              return `${spec.greeting} ${name}`;
            },
          };
        },
        spec.options,
      ),
  };
}

function until(check: () => Promise<boolean>, attempts = 200): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      for (let attempt = 0; attempt < attempts; attempt++) {
        if (yield* Effect.promise(() => check())) return;
        yield* tick;
      }
      throw new Error("condition not reached");
    }),
  );
}

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
  let captured: Ctx | undefined;
  yield* Effect.promise(() =>
    host.root((ctx) => {
      captured = ctx;
    }),
  );

  const writing = greeterFacet({
    greeting: "hi",
    extra: (self) => {
      const probe = self.state("probe", Type.Object({}), {});
      probe.replace(captured!, {});
    },
  });
  yield* Effect.promise(() => assert.rejects(host.reload([writing]), /read_only/u));

  const log: string[] = [];
  const failing = greeterFacet({
    greeting: "hi",
    extra: (self, input) => {
      self.resource("extra", {
        version: 1,
        open: () => void log.push(`open ${input.id}`),
        close: () => void log.push(`close ${input.id}`),
      });
      if (input.id === "b") throw new Error("b fails");
    },
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
    schema: Type.Object({ total: Type.Number() }),
    initial: { total: 0 },
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
  const events: StateEvent<unknown>[] = [];
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
    greeting: "hi",
    schema: Type.Object({ total: Type.Number() }),
    initial: { total: 0 },
    bump: (draft) => {
      draft["total"] = (draft["total"] ?? 0) + 1;
    },
    state: {
      version: 2,
      migrate: (old, from) => {
        froms.push(from);
        return { total: (old as { n: number }).n } as never;
      },
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
    version: 1,
    input: Type.Object({}),
    members: { a: Type.Unknown(), b: Type.Unknown(), bump: method() },
  });
  const migrated: string[] = [];
  const facet = (version: number): Facet => ({
    name: "pair",
    setup: (api) =>
      api.serve(Pair, (_input, _principal, self) => {
        const a = self.state("a", Type.Number(), 1);
        const b = self.state("b", Type.Number(), 1, {
          version,
          migrate: (old, from) => {
            migrated.push(`b ${from}->${version}`);
            return (old as number) * 10;
          },
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
  yield* Effect.promise(() =>
    until(() =>
      ref.greet("probe").then(
        () => false,
        (error: unknown) => isChordError(error, "upgrade_conflict"),
      ),
    ),
  );
  go.open();
  assert.equal(yield* Effect.promise(() => grandfathered), "hello g");
  const report = yield* Effect.promise(() => reload);
  assert.equal(report.gated.length, 1);
  assert.equal(yield* Effect.promise(() => ref.greet("n")), "hi n");
});

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

const aTaskThatIgnoresItsAbort = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const errors: unknown[] = [];
  const host = createHost({
    self: { kind: "host" },
    onError: (error) => errors.push(error),
    taskStopDeadline: 30,
  });
  const log: string[] = [];
  const stuck = latch();
  const facet = (label: string): Facet => ({
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
  const facet = (label: string, fail = false): Facet => ({
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
  const other: Facet = {
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

const checksContractsAtReloadForgottenBumps = Effect.gen(function* () {
  const DocV1 = remote("t.rdoc", {
    version: 1,
    input: Type.Object({}),
    host: hostNamed("host"),
    variants: {
      main: { methods: { read: method(undefined, Type.Object({ text: Type.String() })) } },
    },
  });
  const DocBroken = remote("t.rdoc", {
    version: 1,
    input: Type.Object({}),
    host: hostNamed("host"),
    variants: {
      main: { methods: { read: method(undefined, Type.Object({ text: Type.Number() })) } },
    },
  });
  const DocV2 = remote("t.rdoc", {
    version: 2,
    input: Type.Object({}),
    host: hostNamed("host"),
    variants: {
      main: { methods: { fetch: method(undefined, Type.Object({ body: Type.String() })) } },
    },
  });
  const host = quiet();
  host.install({
    name: "doc",
    setup: (api) => api.serve(DocV1, () => ({ variant: "main", read: () => ({ text: "v1" }) })),
  });
  const consumer = host.hold(DocV1, {});
  assert.deepEqual(yield* Effect.promise(() => consumer.read()), { text: "v1" });

  const broken: Facet = {
    name: "doc",
    setup: (api) => api.serve(DocBroken, () => ({ variant: "main", read: () => ({ text: 1 }) })),
  };
  yield* Effect.promise(() => assert.rejects(host.reload([broken]), /without a version bump/u));

  const fetch = () => ({ body: "v2" });
  const v2: Facet = {
    name: "doc",
    setup: (api) => api.serve(DocV2, () => ({ variant: "main", fetch })),
  };
  yield* Effect.promise(() =>
    assert.rejects(host.reload([v2]), (error) => isChordError(error, "contract_mismatch")),
  );

  const adapted: Facet = {
    name: "doc",
    setup: (api) =>
      api.serve(DocV2, () => ({ variant: "main", fetch }), {
        accepts: {
          1: (current) => ({
            variant: "main",
            read: () => ({
              text: `${(current["fetch"] as typeof fetch)().body} via adapter`,
            }),
          }),
        },
      }),
  };
  yield* Effect.promise(() => host.reload([adapted]));
  assert.deepEqual(yield* Effect.promise(() => consumer.read()), { text: "v2 via adapter" });
  const modern = host.hold(DocV2, {});
  assert.deepEqual(yield* Effect.promise(() => modern.fetch()), { body: "v2" });
});

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
  const Sum = local("t.sum", {
    version: 1,
    input: Type.Object({}),
    members: { sum: Type.Object({ v: Type.Number() }) },
  });
  const facet = (factor: number): Facet => ({
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

const keepsRegistryTablesPerCodeVersion = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const host = quiet();
  const Routes = defineRegistry<string>("t.reload-routes");
  const Router = local("t.router", { version: 1, input: Type.Object({}) });
  const facet = (value: string): Facet => ({
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
    version: 1,
    input: Type.Object({}),
    members: { now: method(undefined, Type.Number()) },
  });
  const clockFacet: Facet = {
    name: "clock",
    setup: (api) => api.serve(Clock, () => ({ now: () => 42 })),
  };
  const consumer = (fail: boolean): Facet => ({
    name: "greeter",
    setup: (api) =>
      api.serve(Greeter, (_input, _principal, self) => {
        const clock = self.get(Clock, {});
        const count = self.state("count", CountV1, { n: 0 });
        if (fail) throw new Error("consumer fails");
        return {
          count,
          greet: (name: string, ctx: Ctx) =>
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
  yield* Effect.promise(() =>
    until(() =>
      ref.greet("probe").then(
        () => false,
        (error: unknown) => isChordError(error, "upgrade_conflict"),
      ),
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

  it("a task that ignores its abort delays its replacement at most taskStopDeadline (reported)", () =>
    Effect.runPromise(aTaskThatIgnoresItsAbort));

  it("a facet's signal aborts when its run is replaced or removed, when its reload aborts, and when the host closes", () =>
    Effect.runPromise(aFacetSSignalAbortsWhen));

  it("checks contracts at reload: forgotten bumps, live consumers, accepts adapters", () =>
    Effect.runPromise(checksContractsAtReloadForgottenBumps));

  it("rebinds listeners to the new code and restarts tasks", () =>
    Effect.runPromise(rebindsListenersToTheNewCode));

  it("keeps registry tables per code version", () =>
    Effect.runPromise(keepsRegistryTablesPerCodeVersion));

  it("a reload can add a type together with a consumer that holds it", () =>
    Effect.runPromise(aReloadCanAddAType));

  it("the gate rejects new objects of a changed type; after commit they get the new code", () =>
    Effect.runPromise(theGateRejectsNewObjectsOf));
});
