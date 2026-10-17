import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expectTypeOf, it } from "vite-plus/test";

import {
  type Ctx,
  createHost,
  defineRegistry,
  type Facet,
  forbidden,
  type Host,
  hostNamed,
  isChordError,
  local,
  method,
  opaque,
  type Ref,
  remote,
  type ServeOptionsFor,
} from "../src/index.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const quiet = (errors: unknown[] = []) =>
  createHost({ self: { kind: "host" }, onError: (error) => errors.push(error) });
function until(check: () => boolean): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      for (let attempt = 0; attempt < 200 && !check(); attempt++)
        yield* Effect.promise(() => tick());
      assert.ok(check(), "condition not reached");
    }),
  );
}

const Counter = local("t.counter", {
  version: 1,
  input: Type.Object({ name: Type.String() }),
  members: {
    count: Type.Object({ n: Type.Number() }),
    add: method(Type.Number(), Type.Number()),
  },
});

function serveCounter(host: Host, log: string[] = [], options: { linger?: number } = {}) {
  host.serve(
    Counter,
    ({ name }, _principal, self) => {
      log.push(`factory ${name}`);
      const count = self.state("count", Type.Object({ n: Type.Number() }), { n: 0 });
      const conn = self.resource("conn", {
        version: 1,
        open: () =>
          Effect.runPromise(
            Effect.sync(() => {
              log.push(`open ${name}`);
              return { name };
            }),
          ),
        close: () => {
          log.push(`close ${name}`);
        },
      });
      return {
        count,
        conn,
        add: (delta: number, ctx) => {
          count.change(ctx, (draft) => {
            draft.n += delta;
          });
          return count.value.n;
        },
      };
    },
    options,
  );
}

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
  yield* Effect.promise(() => tick());
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
  yield* Effect.promise(() => tick());
  assert.equal(yield* Effect.promise(() => b.add(1)), 1);
  b.release();
  yield* Effect.promise(() => tick());
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
  const Slow = local("t.slow", { version: 1, input: Type.Object({}) });
  host.serve(Slow, (_input, _principal, self) => {
    self.resource("r", {
      version: 1,
      open: ({ signal }) =>
        new Promise<string>((resolve) => {
          release = () => resolve("r");
          signal.addEventListener("abort", () => log.push("abort seen"));
        }),
      close: () => {
        log.push("closed");
      },
    });
    return {};
  });
  const ref = host.hold(Slow, {});
  yield* Effect.promise(() => tick());
  ref.release();
  yield* Effect.promise(() => tick());
  release();
  yield* Effect.promise(() => tick());
  yield* Effect.promise(() => tick());
  assert.deepEqual(log, ["abort seen", "closed"]);
  const again = host.hold(Slow, {});
  yield* Effect.promise(() => tick());
  release();
  yield* Effect.promise(() => again.ready);
  assert.equal(again.status, "live");
});

const propagatesActivationFailuresToDependentsAnd = Effect.gen(function* () {
  const host = quiet();
  let fail = true;
  const Leaf = local("t.leaf", { version: 1, input: Type.Object({}) });
  const Parent = local("t.parent", { version: 1, input: Type.Object({}) });
  host.serve(Leaf, (_input, _principal, self) => {
    self.resource("r", {
      version: 1,
      open: () => {
        if (fail) throw new Error("boom");
        return 1;
      },
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
  const Leaf = local("t.leaf2", { version: 1, input: Type.Object({}) });
  const Bad = local("t.bad", { version: 1, input: Type.Object({ async: Type.Boolean() }) });
  let leafLive = 0;
  host.serve(Leaf, (_input, _principal, self) => {
    self.resource("r", {
      version: 1,
      open: () => {
        leafLive++;
      },
      close: () => {
        leafLive--;
      },
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
  yield* Effect.promise(() => tick());
  yield* Effect.promise(() => tick());
  assert.equal(leafLive, 0);
});

const rejectsDuplicateDeclarationNames = Effect.gen(function* () {
  const host = quiet();
  const Dup = local("t.dup", { version: 1, input: Type.Object({}) });
  host.serve(Dup, (_input, _principal, self) => {
    self.state("a", Type.Object({}), {});
    self.state("a", Type.Object({}), {});
    return {};
  });
  yield* Effect.promise(() => assert.rejects(host.hold(Dup, {}).ready, /duplicate state name a/u));
});

const detectsHoldCycles = Effect.gen(function* () {
  const host = quiet();
  const A = local("t.cycle-a", { version: 1, input: Type.Object({}) });
  const B = local("t.cycle-b", { version: 1, input: Type.Object({}) });
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

const closesResourcesInReverseOrderRuns = Effect.gen(function* () {
  const errors: unknown[] = [];
  const host = quiet(errors);
  const log: string[] = [];
  const Multi = local("t.multi", { version: 1, input: Type.Object({}) });
  host.serve(Multi, (_input, _principal, self) => {
    const a = self.resource("a", {
      version: 1,
      open: () => "a",
      close: () => void log.push("close a"),
    });
    self.resource("b", {
      version: 1,
      deps: [a],
      open: () => "b",
      close: () => {
        log.push("close b");
        throw new Error("b failed");
      },
    });
    self.resource("c", {
      version: 1,
      open: () => "c",
      close: () => {
        log.push("close c");
        throw new Error("c failed");
      },
    });
    return {};
  });
  const ref = host.hold(Multi, {});
  yield* Effect.promise(() => ref.ready);
  ref.release();
  yield* Effect.promise(() => tick());
  yield* Effect.promise(() => tick());
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
  yield* Effect.promise(() => tick());
  assert.deepEqual(log, ["factory c", "open c", "close c"]);
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

  it("closes resources in reverse order, runs all steps and aggregates errors", () =>
    Effect.runPromise(closesResourcesInReverseOrderRuns));

  it("releases ctx.get holds when the call settles", () =>
    Effect.runPromise(releasesCtxGetHoldsWhenThe));
});

const refusesASecondDeclarationOfOne = Effect.gen(function* () {
  const host = quiet();
  const Twice = local("t.twice", { version: 1, input: Type.Object({ kind: Type.String() }) });
  host.serve(Twice, ({ kind }, _principal, self) => {
    const open = { version: 1, open: () => null };
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
    version: 1,
    input: Type.Object({}),
    members: {
      ping: method(),
      count: method(undefined, Type.Number()),
      note: method(Type.String()),
    },
  });
  const seen: unknown[] = [];
  host.serve(Tool, () => ({
    ping: (ctx) => {
      seen.push(typeof ctx.rootId);
      return "ignored" as never;
    },
    count: () => 3,
    note: (text, ctx) => {
      seen.push(text, typeof ctx.rootId);
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
    version: 1,
    input: Type.Object({}),
    members: { set: method(Type.Number()) },
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
  yield* Effect.promise(() => until(() => seen.length === 1));
  yield* Effect.promise(() => host.root((ctx) => host.hold(Doubled, {}).set(5, ctx)));
  yield* Effect.promise(() => until(() => seen.length === 2));
  assert.deepEqual(seen, [2, 10]);
  yield* Effect.promise(() => host.reload([facet("v2")]));
  yield* Effect.promise(() => until(() => seen.length === 3));
  yield* Effect.promise(() => tick());
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

describe("host: lifetime", () => {
  const Store = local("t.store", {
    version: 1,
    input: Type.Object({ scope: Type.Optional(Type.String({ default: "all" })) }),
    members: { seen: opaque<unknown>("t.seen@1") },
  });

  it('serve refuses a lifetime "host" the type cannot have, at compile time and at runtime', () => {
    const host = quiet();
    const Remote = remote("t.remote-store", {
      version: 1,
      input: Type.Object({}),
      host: hostNamed("host"),
      variants: { main: {} },
    });
    const Keyed = local("t.keyed", { version: 1, input: Type.Object({ id: Type.String() }) });
    expectTypeOf<{ lifetime: "host" }>().not.toExtend<ServeOptionsFor<typeof Remote>>();
    expectTypeOf<{ lifetime: "host" }>().not.toExtend<ServeOptionsFor<typeof Keyed>>();
    expectTypeOf<{ lifetime: "host"; linger: 10 }>().not.toExtend<ServeOptionsFor<typeof Store>>();
    expectTypeOf<{ lifetime: "forever" }>().not.toExtend<ServeOptionsFor<typeof Store>>();
    const refused: [readonly unknown[], RegExp][] = [
      [[Remote, () => ({ variant: "main" }), { lifetime: "host" }], /needs a local type/u],
      [[Keyed, () => ({}), { lifetime: "host" }], /input that accepts \{\}/u],
      [[Store, () => ({ seen: null }), { lifetime: "host", linger: 10 }], /does not linger/u],
      [[Store, () => ({ seen: null }), { lifetime: "forever" }], /unknown lifetime/u],
    ];
    for (const [args, error] of refused)
      assert.throws(() => Reflect.apply(host.serve, host, args), error);
    const Optional = local("t.optional", {
      version: 1,
      input: Type.Object({ id: Type.Optional(Type.String()) }),
    });
    host.serve(Optional, () => ({}), { lifetime: "host" });
    host.serve(Keyed, () => ({}), { lifetime: "referenced", linger: 10 });
    host.serve(Remote, () => ({ variant: "main" }), { linger: 10 });
  });

  it("every get reaches the one object, created at serve for the host principal; another input is invalid", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const host = createHost({
          self: { kind: "host" },
          principalKey: (principal) => JSON.stringify(principal),
          onError: () => {},
        });
        const created: unknown[] = [];
        host.serve(
          Store,
          (input, principal) => {
            created.push({ input, principal });
            return { seen: principal };
          },
          { lifetime: "host" },
        );
        yield* Effect.promise(() => host.ready());
        assert.equal(created.length, 1, "created when served, before anyone asked");
        const guest = host.hold(Store, {}, { principal: { guest: "g" } });
        const defaults = host.hold(Store, { scope: "all" });
        yield* Effect.promise(() => Promise.all([guest.ready, defaults.ready]));
        assert.equal(
          created.length,
          1,
          "the same object for every principal and the default input",
        );
        assert.deepEqual(
          guest.seen,
          created[0] && (created[0] as { principal: unknown }).principal,
        );
        assert.throws(
          () => host.hold(Store, { scope: "other" }),
          (error) => isChordError(error, "invalid"),
        );
        guest.release();
        defaults.release();
        yield* Effect.promise(() => tick());
        const again = host.hold(Store, {});
        yield* Effect.promise(() => again.ready);
        assert.equal(created.length, 1);
        yield* Effect.promise(() => host.close());
        assert.equal(again.status, "gone");
      }),
    ));
});

const forcedDisposalMakesReferencesGoneAnd = Effect.gen(function* () {
  const host = quiet();
  let seenAbort = false;
  const Slow = local("t.inflight", {
    version: 1,
    input: Type.Object({}),
    members: { wait: method() },
  });
  host.serve(Slow, () => ({
    wait: (ctx) =>
      new Promise<void>((resolve) =>
        ctx.signal.addEventListener("abort", () => {
          seenAbort = true;
          resolve();
        }),
      ),
  }));
  const ref = host.hold(Slow, {}, { principal: { user: "u" } });
  yield* Effect.promise(() => ref.ready);
  const call = ref.wait();
  yield* Effect.promise(() => tick());
  yield* Effect.promise(() =>
    host.invalidatePrincipal((principal) => (principal as { user: string }).user === "u"),
  );
  assert.equal(ref.status, "gone");
  yield* Effect.promise(() => call);
  assert.ok(seenAbort);
  yield* Effect.promise(() => assert.rejects(ref.wait(), (error) => isChordError(error, "gone")));
  const fresh = host.hold(Slow, {}, { principal: { user: "u" } });
  yield* Effect.promise(() => fresh.ready);
  assert.equal(fresh.status, "live");
});

describe("host: principals, variants and disposal", () => {
  const Doc = remote("t.doc", {
    version: 1,
    input: Type.Object({ id: Type.String() }),
    host: hostNamed("host"),
    variants: {
      viewer: { state: { view: Type.Object({ text: Type.String() }) } },
      editor: {
        state: { view: Type.Object({ text: Type.String() }) },
        methods: {
          edit: method(Type.Object({ text: Type.String() }), Type.Object({ ok: Type.Boolean() })),
        },
      },
    },
  });

  function serveDoc(host: Host, principals: unknown[] = []) {
    host.serve(Doc, (_input, principal, self) => {
      principals.push(principal);
      const view = self.state("view", Type.Object({ text: Type.String() }), { text: "" });
      if ((principal as { role?: string }).role !== "editor") return { variant: "viewer", view };
      return {
        variant: "editor",
        view,
        edit: ({ text }, ctx) => {
          view.replace(ctx, { text });
          return text === "bad" ? ({ ok: "no" } as never) : { ok: true };
        },
      };
    });
  }

  it("keeps objects per principal key and enforces variants", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const host = createHost({
          self: { kind: "host" },
          principalKey: (principal) => (principal as { user: string }).user,
          onError: () => {},
        });
        const principals: unknown[] = [];
        serveDoc(host, principals);
        const viewer = host.hold(Doc, { id: "1" }, { principal: { user: "v", role: "viewer" } });
        const editor = host.hold(Doc, { id: "1" }, { principal: { user: "e", role: "editor" } });
        yield* Effect.promise(() => Promise.all([viewer.ready, editor.ready]));
        assert.equal(principals.length, 2);
        assert.equal(viewer.variant, "viewer");
        assert.deepEqual(viewer.shape?.members, ["view"]);
        expectTypeOf(viewer).not.toHaveProperty("edit");
        yield* Effect.promise(() =>
          assert.rejects(
            Reflect.apply(Reflect.get(viewer, "edit"), viewer, [{ text: "x" }]),
            (error) => isChordError(error, "not_in_variant"),
          ),
        );
        assert.ok(editor.variant === "editor");
        assert.deepEqual(yield* Effect.promise(() => editor.edit({ text: "x" })), { ok: true });
        assert.deepEqual(editor.view.value, { text: "x" });
        assert.deepEqual(viewer.view.value, { text: "" });
      }),
    ));

  it("validates remote args and results at the provider boundary", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const host = quiet();
        serveDoc(host);
        const editor = yield* Effect.promise(() =>
          host.get(Doc, { id: "2" }, { principal: { role: "editor" } }),
        );
        assert.ok(editor.variant === "editor");
        yield* Effect.promise(() =>
          assert.rejects(
            editor.edit({ text: 1 } as never),
            (error) => isChordError(error, "invalid") && error.reason === "args",
          ),
        );
        yield* Effect.promise(() =>
          assert.rejects(
            editor.edit({ text: "bad" }),
            (error) => isChordError(error, "invalid") && error.reason === "result",
          ),
        );
      }),
    ));

  it("forced disposal makes references gone and aborts in-flight calls", () =>
    Effect.runPromise(forcedDisposalMakesReferencesGoneAnd));

  it("state members are late-bound readables: values, then snapshot/reset/ops events", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const host = quiet();
        serveDoc(host);
        const editor = host.hold(Doc, { id: "3" }, { principal: { role: "editor" } }) as Ref<
          typeof Doc
        >;
        const shapes: unknown[] = [];
        editor.onShape((shape) => shapes.push(shape.variant));
        const events: unknown[] = [];
        const values: unknown[] = [];
        editor.view.events((event) =>
          events.push(event.type === "ops" ? ["ops", event.ops] : [event.type, event.value]),
        );
        editor.view.subscribe((value) => values.push(value));
        yield* Effect.promise(() => editor.ready);
        assert.ok(editor.variant === "editor");
        yield* Effect.promise(() => editor.edit({ text: "hi" }));
        assert.deepEqual(shapes, ["editor"]);
        assert.deepEqual(events, [
          ["snap", { text: "" }],
          ["ops", [["r", { text: "hi" }]]],
        ]);
        assert.deepEqual(values, [{ text: "" }, { text: "hi" }]);
      }),
    ));
});

describe("host: registries", () => {
  const Routes = defineRegistry<string>("t.routes");

  it('only objects of lifetime "host" register; tables follow registration order', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const host = quiet();
        const RoutesA = local("t.routes-a", { version: 1, input: Type.Object({}) });
        const RoutesB = local("t.routes-b", { version: 1, input: Type.Object({}) });
        host.serve(
          RoutesA,
          (_input, _principal, self) => {
            self.register(Routes, { "GET /a": "a", "GET /c": "c" });
            return {};
          },
          { lifetime: "host" },
        );
        host.serve(
          RoutesB,
          (_input, _principal, self) => {
            self.register(Routes, { "GET /b": "b" });
            return {};
          },
          { lifetime: "host" },
        );
        const tables: string[][] = [];
        host.registry(Routes).subscribe((table) => tables.push([...table.keys()]));
        yield* Effect.promise(() => tick());
        yield* Effect.promise(() => tick());
        assert.deepEqual([...host.registry(Routes).table().keys()], ["GET /a", "GET /c", "GET /b"]);
        assert.equal(host.registry(Routes).get("GET /b"), "b");
        assert.deepEqual(tables.at(-1), ["GET /a", "GET /c", "GET /b"]);

        const Lazy = local("t.lazy-register", { version: 1, input: Type.Object({}) });
        host.serve(Lazy, (_input, _principal, self) => {
          self.register(Routes, { x: "x" });
          return {};
        });
        yield* Effect.promise(() =>
          assert.rejects(
            host.hold(Lazy, {}).ready,
            /only objects of lifetime "host" may register/u,
          ),
        );
      }),
    ));

  it("rejects conflicting registrations", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const errors: unknown[] = [];
        const host = quiet(errors);
        for (const name of ["t.conflict-a", "t.conflict-b"]) {
          host.serve(
            local(name, { version: 1, input: Type.Object({}) }),
            (_input, _principal, self) => {
              self.register(Routes, { same: name });
              return {};
            },
            { lifetime: "host" },
          );
        }
        yield* Effect.promise(() => tick());
        yield* Effect.promise(() => tick());
        assert.ok(errors.some((error) => /registry_conflict/u.test(String(error))));
      }),
    ));
});

const ctxGetActsAsTheRoot = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const host = createHost({
    self: { kind: "host" },
    principalKey: (principal) => JSON.stringify(principal),
    onError: () => {},
  });
  const seen: unknown[] = [];
  const Who = local("t.who", {
    version: 1,
    input: Type.Object({}),
    members: { ping: method() },
  });
  const Front = local("t.front", {
    version: 1,
    input: Type.Object({}),
    members: { relay: method() },
  });
  host.serve(Who, (_input, principal) => {
    seen.push(principal);
    return { ping: () => {} };
  });
  host.serve(Front, (_input, principal) => {
    seen.push(principal);
    return {
      relay: (ctx: Ctx) =>
        Effect.runPromiseWith(services)(
          Effect.gen(function* () {
            const remote = yield* Effect.promise(() => ctx.get(Who, {}));
            return yield* Effect.promise(() => remote.ping(ctx));
          }),
        ),
    };
  });
  yield* Effect.promise(() =>
    host.root(
      (ctx) =>
        Effect.runPromiseWith(services)(
          Effect.gen(function* () {
            const remote = yield* Effect.promise(() => ctx.get(Front, {}));
            return yield* Effect.promise(() => remote.relay(ctx));
          }),
        ),
      {
        principal: { user: "guest" },
      },
    ),
  );
  assert.deepEqual(seen, [{ user: "guest" }, { kind: "host" }]);
});

const aChorderrorFromAFactoryKeeps = Effect.gen(function* () {
  const host = quiet();
  const Secret = local("t.secret", { version: 1, input: Type.Object({}) });
  const Page = local("t.page", { version: 1, input: Type.Object({}) });
  host.serve(Secret, () => {
    throw forbidden("not for you");
  });
  host.serve(Page, (_input, _principal, self) => {
    self.get(Secret, {});
    return {};
  });
  yield* Effect.promise(() =>
    assert.rejects(host.hold(Page, {}).ready, (error) => isChordError(error, "forbidden")),
  );
});

describe("host: composition", () => {
  const Source = local("t.source", {
    version: 1,
    input: Type.Object({}),
    members: { n: Type.Number(), set: method(Type.Number()) },
  });
  const Mirror = local("t.mirror", {
    version: 1,
    input: Type.Object({}),
    members: { copy: Type.Number(), doubled: Type.Number() },
  });

  it("reference state members are sources for listeners and derivations", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const host = quiet();
        host.serve(Source, (_input, _principal, self) => {
          const n = self.state("n", Type.Number(), 1);
          return {
            n,
            set: (value: number, ctx: Ctx) => {
              n.replace(ctx, value);
            },
          };
        });
        host.serve(Mirror, (_input, _principal, self) => {
          const source = self.get(Source, {});
          const copy = self.state("copy", Type.Number(), 0);
          self.on("follow", source.n, (value, ctx) => copy.replace(ctx, value ?? 0));
          const doubled = self.derive([source.n], (n) => (n ?? 0) * 2);
          return { copy, doubled };
        });
        const mirror = host.hold(Mirror, {});
        yield* Effect.promise(() => mirror.ready);
        yield* Effect.promise(() => tick());
        assert.equal(mirror.copy.value, 1);
        assert.equal(mirror.doubled.value, 2);
        yield* Effect.promise(() => host.hold(Source, {}).set(5));
        yield* Effect.promise(() => tick());
        assert.equal(mirror.copy.value, 5);
        assert.equal(mirror.doubled.value, 10);
      }),
    ));

  it("ctx.get acts as the root principal at ingress and as the host inside objects", () =>
    Effect.runPromise(ctxGetActsAsTheRoot));

  it("calling a reference inside a factory throws not_ready", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const host = quiet();
        host.serve(Source, (_input, _principal, self) => ({
          n: self.state("n", Type.Number(), 0),
          set: () => {},
        }));
        const Eager = local("t.eager-call", { version: 1, input: Type.Object({}) });
        host.serve(Eager, (_input, _principal, self) => {
          const source = self.get(Source, {});
          void source.set(1);
          return {};
        });
        yield* Effect.promise(() =>
          assert.rejects(host.hold(Eager, {}).ready, (error) => isChordError(error, "not_ready")),
        );
      }),
    ));

  it("a ChordError from a factory keeps its code through dependents", () =>
    Effect.runPromise(aChorderrorFromAFactoryKeeps));
});
