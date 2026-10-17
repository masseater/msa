import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import { applyImmutable } from "../src/delta/index.ts";
import {
  type Ctx,
  createHost,
  type Facet,
  type FacetLoader,
  hostNamed,
  isChordError,
  local,
  memoryLinkPair,
  method,
  opaque,
  remote,
  type StateEvent,
} from "../src/index.ts";
import { until } from "./fixtures/requests.ts";
import { latch, tick } from "./fixtures/timing.ts";

const case4ReplaceDiffsANewRevision = Effect.gen(function* () {
  const Mirror = local("t.mirror", {
    version: 1,
    input: Type.Object({}),
    members: { doc: Type.Unknown(), set: method(Type.Unknown()) },
  });
  const Doc = Type.Object({ entries: Type.Array(Type.String()), status: Type.String() });
  let lastOptions: { diff?: boolean } | undefined;
  const host = createHost({ self: { kind: "host" }, onError: () => {} });
  host.serve(Mirror, (_input, _principal, self) => {
    const doc = self.state("doc", Doc, { entries: ["a", "b"], status: "idle" });
    return {
      doc,
      set: (value: unknown, ctx: Ctx) => {
        doc.replace(ctx, value as never, lastOptions);
      },
    };
  });
  const ref = host.hold(Mirror, {});
  yield* Effect.promise(() => ref.ready);
  const events: StateEvent<unknown>[] = [];
  let replica: unknown;
  ref.doc.events((event) => {
    replica = event.type === "ops" ? applyImmutable(replica, event.ops) : event.value;
    events.push(event);
  });
  const opsOf = (event: StateEvent<unknown> | undefined) =>
    event?.type === "ops" ? event.ops : [];
  const current = ref.doc.value as { entries: string[]; status: string };
  yield* Effect.promise(() => ref.set({ entries: current.entries, status: "running" }));
  assert.deepEqual(opsOf(events.at(-1)), [["s", ["status"], "running"]]);
  yield* Effect.promise(() => ref.set({ entries: ["a", "b", "c"], status: "running" }));
  assert.equal(opsOf(events.at(-1))[0]?.[0], "r");
  lastOptions = { diff: true };
  yield* Effect.promise(() => ref.set({ entries: ["a", "b", "c", "d"], status: "running" }));
  assert.notEqual(opsOf(events.at(-1))[0]?.[0], "r");
  lastOptions = { diff: false };
  const shared = ref.doc.value as { entries: string[] };
  yield* Effect.promise(() => ref.set({ entries: shared.entries, status: "done" }));
  assert.equal(opsOf(events.at(-1))[0]?.[0], "r");
  yield* tick;
  assert.deepEqual(replica, ref.doc.value);
});

const Echo = remote("t.echo", {
  version: 1,
  input: Type.Object({}),
  host: hostNamed("server"),
  variants: { main: { methods: { codeVersion: method(undefined, Type.Number()) } } },
});

const case5RootsOfAChildThat = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  const echoFacet: Facet = {
    name: "echo",
    setup: (api) =>
      api.serve(Echo, () => ({
        variant: "main",
        codeVersion: (ctx: Ctx) => ctx.codeVersion,
      })),
  };
  server.install(echoFacet);
  yield* Effect.promise(() => server.reload([echoFacet]));
  assert.equal(server.codeVersion, 2);
  assert.equal(server.previousCodeVersion, undefined);
  const loader: FacetLoader = () => Effect.runPromiseWith(services)(Effect.sync(() => []));
  const worker = createHost({
    self: { kind: "host" },
    name: "session:S1",
    loader,
    onError: () => {},
  });
  const go = latch();
  const call = worker.root((ctx) =>
    Effect.runPromiseWith(services)(
      Effect.gen(function* () {
        yield* go.wait;
        const peer = yield* Effect.promise(() => ctx.get(Echo, {}));
        return yield* Effect.promise(() => peer.codeVersion(ctx));
      }),
    ),
  );
  const [down, up] = memoryLinkPair();
  server.accept(down, { principal: { worker: "S1" }, kind: "host", name: "session:S1" });
  worker.connect(up, { principal: { kind: "server" } });
  go.open();
  assert.equal(yield* Effect.promise(() => call), 2);
  yield* until(() => worker.codeVersion === 2);
  yield* Effect.promise(() =>
    assert.rejects(
      server.root(() => 0, { codeVersion: 1 }),
      (error) => isChordError(error, "superseded"),
    ),
  );
});

describe("application requests", () => {
  it("#4 replace diffs a new revision that shares structure; unrelated values replace", () =>
    Effect.runPromise(case4ReplaceDiffsANewRevision));

  it("#5 roots of a child that connected behind the server are admitted in the server's code version", () =>
    Effect.runPromise(case5RootsOfAChildThat));
});

describe("application requests", () => {
  it("#6 self.expose: an opaque member backed by a resource, readable once live", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const services = yield* Effect.context<never>();
        const Store = local("t.store", {
          version: 1,
          input: Type.Object({}),
          members: { db: opaque<{ readonly queries: string[] }>("t.db@1") },
        });
        const gate = latch();
        const native = { queries: [] as string[] };
        const host = createHost({ self: { kind: "host" }, onError: () => {} });
        host.serve(Store, (_input, _principal, self) => {
          const db = self.resource("db", {
            version: 1,
            open: () =>
              Effect.runPromiseWith(services)(
                Effect.gen(function* () {
                  yield* gate.wait;
                  return native;
                }),
              ),
          });
          return { db: self.expose(db) };
        });
        const ref = host.hold(Store, {});
        assert.equal(ref.db, undefined);
        gate.open();
        yield* Effect.promise(() => ref.ready);
        assert.equal(ref.db, native);

        const Other = local("t.other", { version: 1, input: Type.Object({}) });
        host.serve(Other, (_input, _principal, self) => {
          self.expose({ key: "x", value: 1 });
          return {};
        });
        yield* Effect.promise(() =>
          assert.rejects(
            host.hold(Other, {}).ready,
            /expose takes a resource declared by this object/u,
          ),
        );
      }),
    ));
});
