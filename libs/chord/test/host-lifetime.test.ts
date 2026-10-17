import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expectTypeOf, it } from "vite-plus/test";

import {
  createHost,
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
import { quiet } from "./fixtures/host.ts";
import { abortOf, tick } from "./fixtures/timing.ts";

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
        yield* tick;
        const again = host.hold(Store, {});
        yield* Effect.promise(() => again.ready);
        assert.equal(created.length, 1);
        yield* Effect.promise(() => host.close());
        assert.equal(again.status, "gone");
      }),
    ));
});

const forcedDisposalMakesReferencesGoneAnd = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const host = quiet();
  let seenAbort = false;
  const Slow = local("t.inflight", {
    version: 1,
    input: Type.Object({}),
    members: { wait: method() },
  });
  host.serve(Slow, () => ({
    wait: (ctx) =>
      Effect.runPromiseWith(services)(
        abortOf(ctx.signal).pipe(
          Effect.andThen(
            Effect.sync(() => {
              seenAbort = true;
            }),
          ),
        ),
      ),
  }));
  const ref = host.hold(Slow, {}, { principal: { user: "u" } });
  yield* Effect.promise(() => ref.ready);
  const call = ref.wait();
  yield* tick;
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
