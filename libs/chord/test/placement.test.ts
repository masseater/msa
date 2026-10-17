import assert from "node:assert/strict";

import { Effect } from "effect";
import { type Static, Type } from "typebox";
import { describe, expectTypeOf, it } from "vite-plus/test";

import {
  bind,
  createHost,
  type Facet,
  type Frame,
  type Host,
  hostFamily,
  hostNamed,
  isChordError,
  type Link,
  memoryLinkPair,
  method,
  type PlacementFor,
  PROTOCOL_VERSION,
  remote,
} from "../src/index.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

const Note = remote("t.note", {
  version: 1,
  input: Type.Object({ session: Type.String(), id: Type.String() }),
  host: hostFamily("session:", "session"),
  variants: { main: { methods: { where: method(undefined, Type.String()) } } },
});

const Catalog = remote("t.catalog", {
  version: 1,
  input: Type.Object({}),
  host: hostNamed("server"),
  variants: { main: { methods: { where: method(undefined, Type.String()) } } },
});

function cluster() {
  const server = createHost({ name: "server", self: "host", onError: () => {} });
  server.serve(Catalog, () => ({ variant: "main", where: () => "server" }));
  const children = new Map<string, Host>();
  const links = new Map<string, Link>();
  const child = (name: string) => {
    const [down, up] = memoryLinkPair();
    links.set(name, down);
    server.accept(down, { kind: "host", name, principal: "server-side" });
    const host = createHost({
      name,
      self: "host",
      upstream: { link: up, principal: "server" },
      onError: () => {},
    });
    host.serve(Note, ({ id }) => ({ variant: "main", where: () => `${host.name} ${id}` }));
    children.set(name, host);
    return { host, down };
  };
  const s1 = child("session:S1");
  const s2 = child("session:S2");
  const close = () =>
    Effect.runPromise(
      Effect.gen(function* () {
        for (const host of children.values()) yield* Effect.promise(() => host.close());
        yield* Effect.promise(() => server.close());
      }),
    );
  server.route("session:", {
    authorize: () => true,
    resolve: (name) =>
      Effect.runPromise(
        Effect.sync(() => {
          return links.get(name)!;
        }),
      ),
    principal: (name) => name,
  });
  return { server, s1: s1.host, s2: s2.host, close };
}

const aGetGoesWhereTheContract = Effect.gen(function* () {
  const { server, s1, close } = cluster();
  yield* Effect.promise(() => tick());
  assert.equal(
    yield* Effect.promise(() => server.hold(Note, { session: "S1", id: "a" }).where()),
    "session:S1 a",
  );
  assert.equal(
    yield* Effect.promise(() => server.hold(Note, { session: "S2", id: "b" }).where()),
    "session:S2 b",
  );
  assert.equal(
    yield* Effect.promise(() => s1.hold(Note, { session: "S1", id: "c" }).where()),
    "session:S1 c",
  );
  assert.equal(yield* Effect.promise(() => s1.hold(Catalog, {}).where()), "server");
  yield* Effect.promise(() => close());
});

const serveRefusesATypeTheHost = Effect.gen(function* () {
  const host = createHost({ name: "session:S1", self: "host", onError: () => {} });
  assert.throws(
    () => host.serve(Catalog, () => ({ variant: "main", where: () => "" })),
    /t\.catalog is declared for server, but session:S1 serves it/u,
  );
  const server = createHost({ name: "server", self: "host", onError: () => {} });
  assert.throws(
    () => server.serve(Note, () => ({ variant: "main", where: () => "" })),
    /t\.note is declared for session:<session>, but server serves it/u,
  );
  const misplaced: Facet = {
    name: "misplaced",
    setup: (api) => api.serve(Note, () => ({ variant: "main", where: () => "" })),
  };
  yield* Effect.promise(() =>
    assert.rejects(
      server.reload([misplaced]),
      /declared for session:<session>, but server serves it/u,
    ),
  );
  yield* Effect.promise(() => host.close());
  yield* Effect.promise(() => server.close());
});

const aHostRefusesAHoldIts = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const { server, close } = cluster();
  yield* Effect.promise(() => tick());
  const holds = (target: string, input: unknown): Promise<Frame | undefined> =>
    Effect.runPromiseWith(services)(
      Effect.gen(function* () {
        const [down, raw] = memoryLinkPair();
        server.accept(down, { principal: "guest" });
        const frames: Frame[] = [];
        raw.receive((frame) => frames.push(frame));
        raw.send({
          t: "hello",
          protocol: PROTOCOL_VERSION,
          name: "raw",
          kind: "client",
          codeVersion: 0,
        });
        raw.send({ t: "hold", id: 1, at: target, token: Note.description, input });
        for (
          let i = 0;
          i < 50 && !frames.some((frame) => frame.t === "shape" || frame.t === "gone");
          i++
        )
          yield* Effect.promise(() => tick());
        return frames.find((frame) => frame.t === "shape" || frame.t === "gone");
      }),
    );
  const relayed = yield* Effect.promise(() => holds("session:S2", { session: "S1", id: "x" }));
  assert.equal(relayed?.t, "gone");
  assert.match(
    relayed?.t === "gone" ? relayed.error.message : "",
    /placement|does not live on session:S2/u,
  );
  assert.equal(
    (yield* Effect.promise(() => holds("session:S1", { session: "S1", id: "x" })))?.t,
    "shape",
  );
  const direct = yield* Effect.promise(() => holds("server", { session: "S1", id: "x" }));
  assert.equal(direct?.t, "gone");
  yield* Effect.promise(() => close());
});

const theHostComesFromTheNormalized = Effect.gen(function* () {
  const Doc = remote("t.doc-default", {
    version: 1,
    input: Type.Object({ session: Type.String({ default: "S1" }) }),
    host: hostFamily("session:", "session"),
    variants: { main: { methods: { where: method(undefined, Type.String()) } } },
  });
  const { server, s1, close } = cluster();
  s1.serve(Doc, () => ({ variant: "main", where: () => "session:S1" }));
  yield* Effect.promise(() => tick());
  assert.equal(yield* Effect.promise(() => server.hold(Doc, {} as never).where()), "session:S1");
  assert.throws(
    () => server.hold(Note, { session: "", id: "x" }),
    /input field session names no host/u,
  );
  yield* Effect.promise(() => close());
});

const placementIsPartOfTheContract = Effect.gen(function* () {
  const at = (host: string) =>
    remote("t.moved", {
      version: 1,
      input: Type.Object({}),
      host: hostNamed(host),
      variants: { main: { methods: { ping: method() } } },
    });
  assert.notEqual(at("server").fingerprint, at("session:S1").fingerprint);
  const host = createHost({ name: "server", self: "host", onError: () => {} });
  const facet = (version: number, place: string): Facet => ({
    name: "moved",
    setup: (api) =>
      api.serve(
        remote("t.moved", {
          version,
          input: Type.Object({}),
          host: hostNamed(place),
          variants: { main: { methods: { ping: method() } } },
        }),
        () => ({ variant: "main", ping: () => {} }),
        { accepts: { 1: (current) => current } },
      ),
  });
  yield* Effect.promise(() => host.install(facet(1, "server")));
  yield* Effect.promise(() => host.get(at("server"), {}));
  yield* Effect.promise(() =>
    assert.rejects(
      host.reload([facet(1, "session:S1")]),
      /declared for session:S1|without a version bump/u,
    ),
  );
  const moved = remote("t.moved", {
    version: 2,
    input: Type.Object({}),
    host: hostNamed("session:S1"),
    variants: { main: { methods: { ping: method() } } },
  });
  assert.throws(
    () => bind(moved, { 1: (current) => current }, at("server")),
    (error) =>
      isChordError(error, "contract_mismatch") && /lives on session:S1/u.test(error.message),
  );
  yield* Effect.promise(() => host.close());
});

const typesTheFamilySFieldIs = (): void => {
  const input = Type.Object({
    session: Type.String(),
    count: Type.Number(),
    note: Type.Optional(Type.String()),
  });
  const variants = { main: {} };
  remote("t.ok", { version: 1, input, host: hostFamily("session:", "session"), variants });
  type Allowed = PlacementFor<Static<typeof input>>;
  expectTypeOf(hostFamily("session:", "session")).toExtend<Allowed>();
  expectTypeOf(hostFamily("session:", "sesion")).not.toExtend<Allowed>();
  expectTypeOf(hostFamily("session:", "count")).not.toExtend<Allowed>();
  expectTypeOf(hostFamily("session:", "note")).not.toExtend<Allowed>();
  expectTypeOf<{
    version: 1;
    input: typeof input;
    variants: typeof variants;
  }>().not.toExtend<Parameters<typeof remote>[1]>();
  for (const [name, key] of [
    ["t.typo", "sesion"],
    ["t.number", "count"],
    ["t.optional", "note"],
  ] as const)
    Reflect.apply(remote, undefined, [
      name,
      { version: 1, input, host: hostFamily("session:", key), variants },
    ]);
  assert.throws(
    () => Reflect.apply(remote, undefined, ["t.nowhere", { version: 1, input, variants }]),
    /needs `host`/u,
  );
  assert.throws(() => hostFamily("", "session"), /prefix/u);
};

describe("placement", () => {
  it("a get goes where the contract places the input: here, a child, or the parent, never named by the caller", () =>
    Effect.runPromise(aGetGoesWhereTheContract));

  it("serve refuses a type the host is not the place of, also at a reload", () =>
    Effect.runPromise(serveRefusesATypeTheHost));

  it("a host refuses a hold its own contract places elsewhere, and a relay one whose target disagrees", () =>
    Effect.runPromise(aHostRefusesAHoldIts));

  it("the host comes from the normalized input: unknown fields and defaults do not change it", () =>
    Effect.runPromise(theHostComesFromTheNormalized));

  it("placement is part of the contract: a moved type is a breaking change, never bridged by an adapter", () =>
    Effect.runPromise(placementIsPartOfTheContract));

  it(
    "types: the family's field is a required string of the input, and remote contracts need a host",
    typesTheFamilySFieldIs,
  );
});
