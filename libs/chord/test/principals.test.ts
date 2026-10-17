import assert from "node:assert/strict";

import { Type } from "typebox";
import { describe, expectTypeOf, it } from "vite-plus/test";

import {
  type ConnectOptions,
  type Ctx,
  createHost,
  defineFacet,
  type FacetApi,
  type GetOptions,
  type Host,
  type HostOptions,
  hostNamed,
  local,
  memoryLinkPair,
  method,
  type PrincipalMatch,
  remote,
  type Route,
} from "../src/index.ts";

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
  version: 1,
  input: Type.Object({}),
  members: { who: method(undefined, Type.String()) },
});

describe("principals", () => {
  it("factories, methods and contexts see the app's principal type", async () => {
    const host = createHost<Principal>({ self: { kind: "host" }, principalKey });
    const facet = defineFacet<Principal>((api) => {
      const plain: FacetApi = api;
      void plain;
      api.serve(Who, (_input, principal, self) => {
        const created = principal.kind === "guest" ? `guest ${principal.id}` : principal.kind;
        self.task(async (ctx) => {
          const kind: Principal["kind"] = ctx.principal.kind;
          void kind;
        });
        return { who: (ctx) => `${created}, called by ${ctx.principal.kind}` };
      });
    });
    await host.install({ name: "who", ...facet });
    const guest = host.hold(Who, {}, { principal: { kind: "guest", id: "g1" } });
    assert.equal(
      await host.root((ctx) => guest.who(ctx), { principal: { kind: "guest", id: "g1" } }),
      "guest g1, called by host",
    );
    const untyped: Host = host;
    void untyped;
    await host.root(async (ctx) => {
      const plain: Ctx = ctx;
      void plain;
    });
    expectTypeOf<{ principal: { kind: "stranger" } }>().not.toExtend<GetOptions<Principal>>();
    Reflect.apply(host.hold, host, [Who, {}, { principal: { kind: "stranger" } }]);
    expectTypeOf<"id">().toExtend<KeysOf<PrincipalMatch<Principal>>>();
    expectTypeOf<"name">().not.toExtend<KeysOf<PrincipalMatch<Principal>>>();
    void Promise.resolve(
      Reflect.apply(host.invalidatePrincipal, host, [{ kind: "guest", name: "g1" }]),
    ).catch(() => {});
    await host.close();
  });

  it("the host's own principal is recognized by key: an equal object reaches the same objects", async () => {
    const host = createHost<Principal>({ self: { kind: "host" }, principalKey });
    let created = 0;
    host.serve(Who, () => {
      created++;
      return { who: () => "one" };
    });
    const own = host.hold(Who, {});
    const equal = host.hold(Who, {}, { principal: { kind: "host" } });
    await Promise.all([own.ready, equal.ready]);
    assert.equal(created, 1);
    await host.invalidatePrincipal({ kind: "host" });
    assert.equal(own.status, "live");
    await host.close();
  });

  it("a child's parent acts as the principal the child gave `connect`; relayed callers keep theirs", async () => {
    const Echo = remote("t.echo", {
      version: 1,
      input: Type.Object({}),
      host: hostNamed("worker"),
      variants: { main: { methods: { who: method(undefined, Type.String()) } } },
    });
    const server = createHost<Principal>({ name: "server", self: { kind: "host" }, principalKey });
    const [down, up] = memoryLinkPair();
    server.accept(down, { kind: "host", name: "worker", principal: { kind: "host" } });
    const worker = createHost<Principal>({
      name: "worker",
      self: { kind: "host" },
      principalKey,
      upstream: { link: up, principal: { kind: "server" } },
    });
    worker.serve(Echo, (_input, principal) => ({
      variant: "main",
      who: () => principalKey(principal),
    }));
    const [browserDown, browserUp] = memoryLinkPair();
    server.accept(browserDown, { principal: { kind: "guest", id: "g1" } });
    const browser = createHost<Principal>({
      name: "browser",
      kind: "client",
      self: { kind: "host" },
      upstream: { link: browserUp, principal: { kind: "server" } },
    });
    assert.equal(await server.hold(Echo, {}).who(), "server");
    server.route("worker", {
      authorize: () => true,
      resolve: async () => down,
      principal: () => ({ kind: "host" }),
    });
    assert.equal(await browser.hold(Echo, {}).who(), "guest:g1");
    await browser.close();
    await worker.close();
    await server.close();
  });

  it("refuses a host, a parent link or a route without its principal", () => {
    expectTypeOf<{ name: "x" }>().not.toExtend<HostOptions>();
    assert.throws(() => Reflect.apply(createHost, undefined, [{ name: "x" }]), /needs `self`/u);
    const host = createHost({ self: "host" });
    const [, up] = memoryLinkPair();
    expectTypeOf<Record<never, never>>().not.toExtend<ConnectOptions>();
    assert.throws(() => Reflect.apply(host.connect, host, [up, {}]), /connect needs `principal`/u);
    expectTypeOf<Omit<Route, "principal">>().not.toExtend<Route>();
    assert.throws(
      () =>
        Reflect.apply(host.route, host, ["w:", { authorize: () => true, resolve: async () => up }]),
      /needs `principal`/u,
    );
  });
});
