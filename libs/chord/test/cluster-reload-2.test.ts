import assert from "node:assert/strict";

import { Clock, type Context, Effect } from "effect";
import { Type } from "typebox";
import { describe, it, onTestFinished } from "vite-plus/test";

import {
  type Ctx,
  type Facet,
  type FacetLoader,
  type Host,
  createHost,
  hostNamed,
  local,
  memoryLinkPair,
  method,
  remote,
} from "../src/index.ts";
import cluster from "./fixtures/cluster.ts";
import timing from "./fixtures/timing.ts";
import type timingTypes from "./fixtures/timing.types.ts";

const { Ping, dropping, greeterFacet } = cluster;
const { latch, tick } = timing;

const aChildBehindWhoseHelloWaits = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const pingFacet: Facet = {
    name: "ping",
    setup: (api) => api.serve(Ping, () => ({ ping: () => "pong", variant: "main" })),
  };
  const loading = latch();
  const server = createHost({
    loader: (names) =>
      Effect.runPromiseWith(services)(
        Effect.gen(function* () {
          yield* loading.wait;
          return names.map((name) => ({ name: String(name), setup: () => {} }));
        }),
      ),
    name: "server",
    onError: () => {},
    self: { kind: "host" },
  });
  onTestFinished(() => server.close());
  server.install(pingFacet);
  yield* Effect.promise(() => server.reload([pingFacet]));
  assert.equal(server.previousCodeVersion, undefined, "code version 1 is retired");
  const reloading = server.reload(["server-plugin"], { remote: { "session:": [] } });
  const [down, up] = memoryLinkPair();
  server.accept(down, { kind: "host", name: "session:S1", principal: { worker: "w" } });
  const worker = createHost({
    name: "session:S1",
    onError: () => {},
    self: { kind: "host" },
    upstream: { link: up, principal: { kind: "server" } },
  });
  onTestFinished(() => worker.close());
  const answer = yield* Effect.promise(() =>
    worker.root((ctx) =>
      Effect.runPromiseWith(services)(
        Effect.gen(function* () {
          const peer = yield* Effect.promise(() => ctx.get(Ping, {}));
          return yield* Effect.promise(() => peer.ping(ctx));
        }),
      ),
    ),
  );
  assert.equal(answer, "pong");
  loading.open();
  yield* Effect.promise(() => reloading);
  for (let i = 0; i < 50 && worker.codeVersion !== server.codeVersion; i++) yield* tick;
  assert.equal(worker.codeVersion, server.codeVersion);
});

const aReconnectingChildBehindItsParent = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const modules = new Map<string, Facet>([["greeter", greeterFacet("v1")]]);
  const loader: FacetLoader = (names) =>
    Effect.runPromiseWith(services)(
      Effect.sync(() => names.map((name) => modules.get(String(name))!)),
    );
  const server = createHost({ name: "server", onError: () => {}, self: { kind: "host" } });
  onTestFinished(() => server.close());
  const [down, up] = memoryLinkPair();
  server.accept(
    dropping(down, (frame) => frame.t === "retire"),
    { kind: "host", name: "session:S1", principal: { worker: "w" } },
  );
  const worker = createHost({
    loader,
    name: "session:S1",
    onError: () => {},
    self: { kind: "host" },
    upstream: { link: up, principal: { kind: "server" } },
  });
  onTestFinished(() => worker.close());
  worker.install(modules.get("greeter")!);
  yield* tick;
  modules.set("greeter", greeterFacet("v2"));
  yield* Effect.promise(() => server.reload([], { remote: { "session:": ["greeter"] } }));
  yield* tick;
  assert.equal(worker.previousCodeVersion, 1);
  up.close("gone");
  yield* tick;
  modules.set("greeter", greeterFacet("v3"));
  yield* Effect.promise(() => server.reload([{ name: "server-plugin", setup: () => {} }]));
  const [down2, up2] = memoryLinkPair();
  server.accept(down2, { kind: "host", name: "session:S1", principal: { worker: "w" } });
  const started = yield* Clock.currentTimeMillis;
  worker.connect(up2, { principal: { kind: "server" } });
  for (let i = 0; i < 400 && worker.codeVersion !== server.codeVersion; i++) yield* Effect.sleep(5);
  assert.equal(worker.codeVersion, server.codeVersion);
  const elapsed = (yield* Clock.currentTimeMillis) - started;
  assert.ok(elapsed < 2000, `reconciled after ${elapsed} ms`);
});

const Slow = remote("t.cluster-slow", {
  host: hostNamed("session:S1"),
  input: Type.Object({}),
  variants: { main: { methods: { wait: method() } } },
  version: 1,
});

const Store = local("t.cluster-store", { input: Type.Object({}), version: 1 });

const connectGuestBrowser = (server: Host): Host => {
  const [browserDown, browserUp] = memoryLinkPair();
  server.accept(browserDown, { principal: { guest: "g" } });
  const browser = createHost({
    kind: "client",
    name: "browser",
    onError: () => {},
    self: { kind: "host" },
    upstream: { link: browserUp, principal: { kind: "server" } },
  });
  onTestFinished(() => browser.close());
  return browser;
};

const loggingStoreFacet = (log: string[]): ((version: number) => Facet) => {
  const storeFacet = (version: number): Facet => ({
    name: "store",
    setup: (api) =>
      api.serve(
        Store,
        (_input, _principal, self) => {
          self.resource("conn", {
            close: () => void log.push(`server closes ${version}`),
            open: () => ({}),
            version,
          });
          return {};
        },
        { lifetime: "host" },
      ),
  });
  return storeFacet;
};

const serveSlowUntil = (
  worker: Host,
  log: string[],
  never: timingTypes.Latch,
  services: Context.Context<never>,
): void => {
  worker.serve(Slow, () => ({
    variant: "main",
    wait: (ctx: Ctx) =>
      Effect.runPromiseWith(services)(
        Effect.gen(function* () {
          ctx.signal.addEventListener("abort", () => log.push("worker aborted"));
          yield* never.wait;
        }),
      ),
  }));
};

const forcedRetirementCancelsABrowserCall = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const log: string[] = [];
  const server = createHost({ name: "server", onError: () => {}, self: { kind: "host" } });
  onTestFinished(() => server.close());
  const [down, up] = memoryLinkPair();
  const worker = createHost({
    name: "session:S1",
    onError: () => {},
    self: { kind: "host" },
    upstream: { link: up, principal: { kind: "server" } },
  });
  onTestFinished(() => worker.close());
  const never = latch();
  serveSlowUntil(worker, log, never, services);
  const watched = dropping(down, (frame) => {
    if (frame.t === "cancel") log.push("cancel sent");
    return false;
  });
  server.route("session:", {
    authorize: () => true,
    principal: (name) => ({ host: name }),
    resolve: () => Effect.runPromiseWith(services)(Effect.succeed(watched)),
  });
  const storeFacet = loggingStoreFacet(log);
  yield* Effect.promise(() => server.install(storeFacet(1)));
  const browser = connectGuestBrowser(server);
  const call = browser.hold(Slow, {}).wait();
  call.catch(() => {});
  for (let i = 0; i < 50 && log.length === 0 && worker.codeVersion === 0; i++) yield* tick;
  yield* Effect.sleep(10);
  yield* Effect.promise(() => server.reload([storeFacet(2)]));
  yield* Effect.promise(() => server.reload([storeFacet(3)], { retireDeadline: 20 }));
  const settled = yield* Effect.promise(() =>
    call.then(
      () => "resolved",
      () => "rejected",
    ),
  ).pipe(Effect.timeoutOrElse({ duration: 2000, orElse: () => Effect.succeed("pending") }));
  assert.equal(settled, "rejected", "the browser's call is cancelled with its root");
  for (let i = 0; i < 50 && !log.includes("worker aborted"); i++) yield* tick;
  assert.deepEqual(
    log.filter((entry) => entry === "cancel sent" || entry === "server closes 1"),
    ["cancel sent", "server closes 1"],
  );
  assert.ok(log.includes("worker aborted"));
  never.open();
});

describe("cross-host reload", () => {
  it("a child behind whose hello waits for a running reload is fenced at once: its calls up are admitted (spec 9)", () =>
    Effect.runPromise(aChildBehindWhoseHelloWaits));

  it("a reconnecting child behind its parent, still retaining its previous code version, reconciles without waiting out the retire deadline", () =>
    Effect.runPromise(aReconnectingChildBehindItsParent));

  it("forced retirement cancels a browser call relayed to a worker before the server closes the old code's resources", () =>
    Effect.runPromise(forcedRetirementCancelsABrowserCall));
});
