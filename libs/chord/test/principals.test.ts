import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expectTypeOf, it } from "vite-plus/test";

import chord from "../src/index.ts";
import type chordTypes from "../src/index.types.ts";

const { createHost, defineFacet, hostNamed, local, memoryLinkPair, method, remote } = chord;

type KeysOf<U> = U extends (...args: never[]) => unknown
  ? never
  : U extends object
    ? keyof U
    : never;

type Principal =
  | { readonly kind: "owner" }
  | { readonly kind: "guest"; readonly id: string }
  | { readonly kind: "server" }
  | { readonly kind: "host" };

const principalKey = (principal: Principal): string =>
  principal.kind === "guest" ? `guest:${principal.id}` : principal.kind;

const Who = local("t.who", {
  input: Type.Object({}),
  members: { who: method(undefined, Type.String()) },
  version: 1,
});

const factoriesMethodsAndContextsSeeThe = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const host = createHost<Principal>({ principalKey, self: { kind: "host" } });
  const facet = defineFacet<Principal>((api) => {
    const plain: chordTypes.FacetApi = api;
    void plain;
    api.serve(Who, (_input, principal, self) => {
      const created = principal.kind === "guest" ? `guest ${principal.id}` : principal.kind;
      self.task((ctx) =>
        Effect.runPromiseWith(services)(
          Effect.sync(() => {
            const kind: Principal["kind"] = ctx.principal.kind;
            void kind;
          }),
        ),
      );
      return { who: (ctx) => `${created}, called by ${ctx.principal.kind}` };
    });
  });
  yield* Effect.promise(() => host.install({ name: "who", ...facet }));
  const guest = host.hold(Who, {}, { principal: { id: "g1", kind: "guest" } });
  assert.equal(
    yield* Effect.promise(() =>
      host.root((ctx) => guest.who(ctx), { principal: { id: "g1", kind: "guest" } }),
    ),
    "guest g1, called by host",
  );
  const untyped: chordTypes.Host = host;
  void untyped;
  yield* Effect.promise(() =>
    host.root((ctx) =>
      Effect.runPromiseWith(services)(
        Effect.sync(() => {
          const plain: chordTypes.Ctx = ctx;
          void plain;
        }),
      ),
    ),
  );
  expectTypeOf<{ principal: { kind: "stranger" } }>().not.toExtend<
    chordTypes.GetOptions<Principal>
  >();
  Reflect.apply(host.hold, host, [Who, {}, { principal: { kind: "stranger" } }]);
  expectTypeOf<"id">().toExtend<KeysOf<chordTypes.PrincipalMatch<Principal>>>();
  expectTypeOf<"name">().not.toExtend<KeysOf<chordTypes.PrincipalMatch<Principal>>>();
  void Promise.resolve(
    Reflect.apply(host.invalidatePrincipal, host, [{ kind: "guest", name: "g1" }]),
  ).catch(() => {});
  yield* Effect.promise(() => host.close());
});

const theHostSOwnPrincipalIs = Effect.gen(function* () {
  const host = createHost<Principal>({ principalKey, self: { kind: "host" } });
  let created = 0;
  host.serve(Who, () => {
    created++;
    return { who: () => "one" };
  });
  const own = host.hold(Who, {});
  const equal = host.hold(Who, {}, { principal: { kind: "host" } });
  yield* Effect.promise(() => Promise.all([own.ready, equal.ready]));
  assert.equal(created, 1);
  yield* Effect.promise(() => host.invalidatePrincipal({ kind: "host" }));
  assert.equal(own.status, "live");
  yield* Effect.promise(() => host.close());
});

const aChildSParentActsAs = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const Echo = remote("t.echo", {
    host: hostNamed("worker"),
    input: Type.Object({}),
    variants: { main: { methods: { who: method(undefined, Type.String()) } } },
    version: 1,
  });
  const server = createHost<Principal>({
    name: "server",
    principalKey,
    self: { kind: "host" },
  });
  const [down, up] = memoryLinkPair();
  server.accept(down, { kind: "host", name: "worker", principal: { kind: "host" } });
  const worker = createHost<Principal>({
    name: "worker",
    principalKey,
    self: { kind: "host" },
    upstream: { link: up, principal: { kind: "server" } },
  });
  worker.serve(Echo, (_input, principal) => ({
    variant: "main",
    who: () => principalKey(principal),
  }));
  const [browserDown, browserUp] = memoryLinkPair();
  server.accept(browserDown, { principal: { id: "g1", kind: "guest" } });
  const browser = createHost<Principal>({
    kind: "client",
    name: "browser",
    self: { kind: "host" },
    upstream: { link: browserUp, principal: { kind: "server" } },
  });
  assert.equal(yield* Effect.promise(() => server.hold(Echo, {}).who()), "server");
  server.route("worker", {
    authorize: () => true,
    principal: () => ({ kind: "host" }),
    resolve: () => Effect.runPromiseWith(services)(Effect.sync(() => down)),
  });
  assert.equal(yield* Effect.promise(() => browser.hold(Echo, {}).who()), "guest:g1");
  yield* Effect.promise(() => browser.close());
  yield* Effect.promise(() => worker.close());
  yield* Effect.promise(() => server.close());
});

const refusesAHostAParentLink = (): void => {
  expectTypeOf<{ name: "x" }>().not.toExtend<chordTypes.HostOptions>();
  assert.throws(() => Reflect.apply(createHost, undefined, [{ name: "x" }]), /needs `self`/u);
  const host = createHost({ self: "host" });
  const [, up] = memoryLinkPair();
  expectTypeOf<Record<never, never>>().not.toExtend<chordTypes.ConnectOptions>();
  assert.throws(() => Reflect.apply(host.connect, host, [up, {}]), /connect needs `principal`/u);
  expectTypeOf<Omit<chordTypes.Route, "principal">>().not.toExtend<chordTypes.Route>();
  assert.throws(
    () =>
      Reflect.apply(host.route, host, [
        "w:",
        {
          authorize: () => true,
          resolve: () => Effect.runPromise(Effect.sync(() => up)),
        },
      ]),
    /needs `principal`/u,
  );
};

describe("principals", () => {
  it("factories, methods and contexts see the app's principal type", () =>
    Effect.runPromise(factoriesMethodsAndContextsSeeThe));

  it("the host's own principal is recognized by key: an equal object reaches the same objects", () =>
    Effect.runPromise(theHostSOwnPrincipalIs));

  it("a child's parent acts as the principal the child gave `connect`; relayed callers keep theirs", () =>
    Effect.runPromise(aChildSParentActsAs));

  it("refuses a host, a parent link or a route without its principal", refusesAHostAParentLink);
});
