import assert from "node:assert/strict";

import { Clock, Effect } from "effect";
import { Type } from "typebox";
import { describe, it, onTestFinished } from "vite-plus/test";

import {
  type Ctx,
  createHost,
  type Facet,
  type FacetLoader,
  type Frame,
  hostFamily,
  hostNamed,
  isChordError,
  type Link,
  local,
  memoryLinkPair,
  method,
  remote,
  type Self,
} from "../src/index.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function latch() {
  let open = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

const Greeter = remote("t.greeter", {
  version: 1,
  input: Type.Object({ session: Type.String() }),
  host: hostFamily("session:", "session"),
  variants: {
    main: {
      state: { count: Type.Object({ n: Type.Number() }) },
      methods: { greet: method(Type.String(), Type.String()) },
    },
  },
});

const GreeterV2 = remote("t.greeter", {
  version: 2,
  input: Type.Object({ session: Type.String() }),
  host: hostFamily("session:", "session"),
  variants: { main: { methods: { hello: method(Type.String(), Type.String()) } } },
});

const ServerGreeter = remote("t.server-greeter", {
  version: 1,
  input: Type.Object({}),
  host: hostNamed("server"),
  variants: {
    main: {
      state: { count: Type.Object({ n: Type.Number() }) },
      methods: { greet: method(Type.String(), Type.String()) },
    },
  },
});

function greeterFacet(
  greeting: string,
  options: { fail?: boolean; stateVersion?: number } = {},
): Facet {
  return {
    name: "greeter",
    setup: (api) => {
      const greeter = (self: Self) => {
        if (options.fail === true) throw new Error("worker factory fails");
        const count = self.state(
          "count",
          Type.Object({ n: Type.Number() }),
          { n: 0 },
          { version: options.stateVersion ?? 1 },
        );
        return {
          variant: "main" as const,
          count,
          greet: (name: string, ctx: Ctx) => {
            count.change(ctx, (draft) => {
              draft.n += 1;
            });
            return `${greeting} ${name}`;
          },
        };
      };
      if (api.name === "server")
        api.serve(ServerGreeter, (_input, _principal, self) => greeter(self));
      else api.serve(Greeter, (_input, _principal, self) => greeter(self));
    },
  };
}

function dropping(link: Link, drop: (frame: Frame) => boolean): Link {
  return {
    get closed() {
      return link.closed;
    },
    send: (frame) => (drop(frame) ? undefined : link.send(frame)),
    receive: (handler) => link.receive(handler),
    onClose: (handler) => link.onClose(handler),
    close: (reason) => link.close(reason),
  };
}

const Ping = remote("t.cluster-ping", {
  version: 1,
  input: Type.Object({}),
  host: hostNamed("server"),
  variants: { main: { methods: { ping: method(undefined, Type.String()) } } },
});

function setup() {
  const modules = new Map<string, Facet>([["greeter", greeterFacet("v1")]]);
  const loader: FacetLoader = (names) =>
    Effect.runPromise(
      Effect.sync(() => {
        return names.map((name) => modules.get(String(name))!);
      }),
    );
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  const [down, up] = memoryLinkPair();
  server.accept(down, { principal: { worker: "w" }, kind: "host", name: "session:S1" });
  const worker = createHost({
    self: { kind: "host" },
    name: "session:S1",
    upstream: { link: up, principal: { kind: "server" } },
    loader,
    onError: () => {},
  });
  worker.install(modules.get("greeter")!);
  return { server, worker, modules, down };
}

const preparesEveryHostCommitsTheServer = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const { server, worker, modules } = setup();
  yield* Effect.promise(() => tick());
  const greeter = server.hold(Greeter, { session: "S1" });
  assert.equal(yield* Effect.promise(() => greeter.greet("a")), "v1 a");
  const go = latch();
  const pinned = server.root((ctx) =>
    Effect.runPromiseWith(services)(
      Effect.gen(function* () {
        yield* Effect.promise(() => greeter.greet("p", ctx));
        yield* Effect.promise(() => go.promise);
        return yield* Effect.promise(() => greeter.greet("p", ctx));
      }),
    ),
  );
  yield* Effect.promise(() => tick());
  const shapes: string[] = [];
  greeter.onShape((shape) => shapes.push(shape.contract));
  modules.set("greeter", greeterFacet("v2"));
  const report = yield* Effect.promise(() =>
    server.reload([], { remote: { "session:": ["greeter"] } }),
  );
  assert.equal(yield* Effect.promise(() => greeter.greet("b")), "v2 b");
  assert.equal(server.codeVersion, report.codeVersion);
  assert.equal(worker.codeVersion, report.codeVersion);
  go.open();
  assert.equal(yield* Effect.promise(() => pinned), "v1 p");
  assert.equal(shapes.length, 1, "one shape push at the commit");
  for (let i = 0; i < 20 && worker.previousCodeVersion !== undefined; i++)
    yield* Effect.promise(() => tick());
  assert.equal(server.previousCodeVersion, undefined);
  assert.equal(worker.previousCodeVersion, undefined);
});

const aFailingVoteAbortsEveryHost = Effect.gen(function* () {
  const { server, worker, modules } = setup();
  yield* Effect.promise(() => tick());
  const greeter = server.hold(Greeter, { session: "S1" });
  yield* Effect.promise(() => greeter.greet("a"));
  const before = [server.codeVersion, worker.codeVersion];
  modules.set("greeter", greeterFacet("v2", { fail: true }));
  yield* Effect.promise(() =>
    assert.rejects(server.reload([], { remote: { "session:": ["greeter"] } }), (error) => {
      assert.ok(isChordError(error, "unavailable"));
      assert.match(error.message, /session:S1: .*worker factory fails/u);
      return true;
    }),
  );
  assert.deepEqual([server.codeVersion, worker.codeVersion], before);
  assert.equal(yield* Effect.promise(() => greeter.greet("x")), "v1 x");
});

const aWorkerGateBlockedPastIts = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const { server, worker, modules } = setup();
  yield* Effect.promise(() => tick());
  const greeter = server.hold(Greeter, { session: "S1" });
  const go = latch();
  const blocker = server.root((ctx) =>
    Effect.runPromiseWith(services)(
      Effect.gen(function* () {
        yield* Effect.promise(() => greeter.greet("g", ctx));
        yield* Effect.promise(() => go.promise);
      }),
    ),
  );
  yield* Effect.promise(() => tick());
  const before = [server.codeVersion, worker.codeVersion];
  const bumped = greeterFacet("v2", { stateVersion: 2 });
  modules.set("greeter", bumped);
  yield* Effect.promise(() =>
    assert.rejects(
      server.reload([], { remote: { "session:": ["greeter"] }, gateDeadline: 30 }),
      (error) => {
        assert.ok(isChordError(error, "aborted") && error.reason === "gate_deadline");
        assert.match(error.message, /session:S1: .*blocking roots: server#\w+:\d+/u);
        return true;
      },
    ),
  );
  assert.deepEqual([server.codeVersion, worker.codeVersion], before);
  go.open();
  yield* Effect.promise(() => blocker);
  assert.equal(yield* Effect.promise(() => greeter.greet("x")), "v1 x");
});

const removesFacetsFromServerAndWorkers = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const { server, worker, modules } = setup();
  onTestFinished(() =>
    Effect.runPromiseWith(services)(
      Effect.gen(function* () {
        yield* Effect.promise(() => worker.close());
        yield* Effect.promise(() => server.close());
      }),
    ),
  );
  yield* Effect.promise(() => server.install(greeterFacet("v1")));
  yield* Effect.promise(() => tick());
  const onServer = server.hold(ServerGreeter, {});
  const child = server.hold(Greeter, { session: "S1" });
  assert.equal(yield* Effect.promise(() => onServer.greet("a")), "v1 a");
  assert.equal(yield* Effect.promise(() => child.greet("a")), "v1 a");
  yield* Effect.promise(() =>
    server.reload([], { remove: ["greeter"], remoteRemove: { "session:": ["greeter"] } }),
  );
  for (let i = 0; i < 20 && child.status !== "gone"; i++) yield* Effect.promise(() => tick());
  assert.equal(onServer.status, "gone");
  assert.equal(child.status, "gone");

  const cold = createHost({
    self: { kind: "host" },
    name: "session:cold",
    loader: () =>
      Effect.runPromiseWith(services)(
        Effect.sync(() => {
          assert.fail("Removed modules must not be imported");
        }),
      ),
    onError: () => {},
  });
  onTestFinished(() => cold.close());
  yield* Effect.promise(() => cold.install(greeterFacet("v1")));
  const old = cold.hold(Greeter, { session: "cold" });
  yield* Effect.promise(() => old.ready);
  const [down, up] = memoryLinkPair();
  server.accept(down, { principal: { worker: "cold" }, kind: "host", name: "session:cold" });
  cold.connect(up, { principal: { kind: "server" } });
  for (let i = 0; i < 20 && old.status !== "gone"; i++) yield* Effect.promise(() => tick());
  assert.equal(old.status, "gone");
  assert.equal(cold.codeVersion, server.codeVersion);
  yield* Effect.promise(() => cold.close());
  modules.set("greeter", greeterFacet("v2"));
  yield* Effect.promise(() =>
    server.reload([greeterFacet("v2")], { remote: { "session:": ["greeter"] } }),
  );
  assert.equal(
    yield* Effect.promise(() => server.hold(Greeter, { session: "S1" }).greet("b")),
    "v2 b",
  );
  const fresh = createHost({
    self: { kind: "host" },
    name: "session:fresh",
    loader: (names) =>
      Effect.runPromiseWith(services)(
        Effect.sync(() => {
          return names.map((name) => modules.get(String(name))!);
        }),
      ),
    onError: () => {},
  });
  onTestFinished(() => fresh.close());
  yield* Effect.promise(() => fresh.install(greeterFacet("v1")));
  const [freshDown, freshUp] = memoryLinkPair();
  server.accept(freshDown, {
    principal: { worker: "fresh" },
    kind: "host",
    name: "session:fresh",
  });
  fresh.connect(freshUp, { principal: { kind: "server" } });
  assert.equal(
    yield* Effect.promise(() => server.hold(Greeter, { session: "fresh" }).greet("c")),
    "v2 c",
  );
});

const onlyTheServerCoordinatesReloads = Effect.gen(function* () {
  const { worker } = setup();
  yield* Effect.promise(() => tick());
  yield* Effect.promise(() =>
    assert.rejects(worker.reload([]), (error) => isChordError(error, "unavailable")),
  );
});

const browsersAreNotParticipantsTheySee = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const { server, modules, down: workerLink } = setup();
  server.route("session:", {
    authorize: () => true,
    resolve: () =>
      Effect.runPromiseWith(services)(
        Effect.sync(() => {
          return workerLink;
        }),
      ),
    principal: (name) => ({ host: name }),
  });
  const [down, up] = memoryLinkPair();
  server.accept(down, { principal: { guest: "g" } });
  const browser = createHost({
    self: { kind: "host" },
    name: "browser",
    kind: "client",
    upstream: { link: up, principal: { kind: "server" } },
    onError: () => {},
  });
  const viewer = browser.hold(Greeter, { session: "S1" });
  assert.equal(yield* Effect.promise(() => viewer.greet("a")), "v1 a");
  const shapes: string[] = [];
  viewer.onShape((shape) => shapes.push(shape.contract));
  modules.set("greeter", greeterFacet("v2"));
  yield* Effect.promise(() => server.reload([], { remote: { "session:": ["greeter"] } }));
  for (let i = 0; i < 20 && shapes.length === 0; i++) yield* Effect.promise(() => tick());
  assert.equal(shapes.length, 1, "one shape push at the commit");
  assert.equal(yield* Effect.promise(() => viewer.greet("b")), "v2 b");

  modules.set("greeter", {
    name: "greeter",
    setup: (api) =>
      api.serve(GreeterV2, () => ({
        variant: "main",
        hello: (name: string) => `hi ${name}`,
      })),
  });
  yield* Effect.promise(() => server.reload([], { remote: { "session:": ["greeter"] } }));
  for (let i = 0; i < 20 && viewer.status !== "gone"; i++) yield* Effect.promise(() => tick());
  assert.equal(viewer.status, "gone");
  assert.ok(isChordError(viewer.error, "upgrade_required"));
});

const anAbortWhileAWorkerIs = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const { server, worker, modules } = setup();
  yield* Effect.promise(() => tick());
  const greeter = server.hold(Greeter, { session: "S1" });
  yield* Effect.promise(() => greeter.greet("a"));
  const log: string[] = [];
  const go = latch();
  const slow: Facet = {
    name: "greeter",
    setup: (api) =>
      api.serve(Greeter, (_input, _principal, self) => {
        self.resource("late", {
          version: 1,
          open: () =>
            Effect.runPromiseWith(services)(
              Effect.gen(function* () {
                yield* Effect.promise(() => go.promise);
                log.push("opened");
              }),
            ),
          close: () => void log.push("closed"),
        });
        const count = self.state("count", Type.Object({ n: Type.Number() }), { n: 0 });
        return { variant: "main", count, greet: (name: string) => `slow ${name}` };
      }),
  };
  modules.set("greeter", slow);
  const codeVersion = worker.codeVersion;
  yield* Effect.promise(() =>
    assert.rejects(
      server.reload([], { remote: { "session:": ["greeter"] }, voteDeadline: 50 }),
      (error) => isChordError(error, "aborted"),
    ),
  );
  go.open();
  for (let i = 0; i < 50 && !log.includes("closed"); i++) yield* Effect.promise(() => tick());
  assert.deepEqual(log, ["opened", "closed"]);
  assert.equal(worker.codeVersion, codeVersion);
  modules.set("greeter", greeterFacet("v3"));
  yield* Effect.promise(() => server.reload([], { remote: { "session:": ["greeter"] } }));
  assert.equal(yield* Effect.promise(() => greeter.greet("b")), "v3 b");
});

const aChildThatSaysHelloWhile = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const modules = new Map<string, Facet>([["greeter", greeterFacet("v1")]]);
  const loading = latch();
  const server = createHost({
    self: { kind: "host" },
    name: "server",
    onError: () => {},
    loader: (names) =>
      Effect.runPromiseWith(services)(
        Effect.gen(function* () {
          yield* Effect.promise(() => loading.promise);
          return names.map((name) => ({ name: String(name), setup: () => {} }));
        }),
      ),
  });
  onTestFinished(() => server.close());
  const reloading = server.reload(["server-plugin"], { remote: { "session:": ["greeter"] } });
  const [down, up] = memoryLinkPair();
  server.accept(down, { principal: { worker: "w" }, kind: "host", name: "session:S1" });
  const worker = createHost({
    self: { kind: "host" },
    name: "session:S1",
    upstream: { link: up, principal: { kind: "server" } },
    loader: (names) =>
      Effect.runPromiseWith(services)(
        Effect.sync(() => {
          return names.map((name) => modules.get(String(name))!);
        }),
      ),
    onError: () => {},
  });
  onTestFinished(() => worker.close());
  worker.install(modules.get("greeter")!);
  yield* Effect.promise(() => tick());
  modules.set("greeter", greeterFacet("v2"));
  loading.open();
  const report = yield* Effect.promise(() => reloading);
  assert.deepEqual(Object.keys(report.children ?? {}), [], "it was not a participant");
  const greeter = server.hold(Greeter, { session: "S1" });
  assert.equal(yield* Effect.promise(() => greeter.greet("a")), "v2 a");
  assert.equal(worker.codeVersion, server.codeVersion);
});

const aChildKeepsThePreviousCode = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const { server, worker, modules } = setup();
  yield* Effect.promise(() => tick());
  const greeter = server.hold(Greeter, { session: "S1" });
  assert.equal(yield* Effect.promise(() => greeter.greet("a")), "v1 a");
  const first = server.codeVersion;
  const go = latch();
  const pinned = server.root((ctx) =>
    Effect.runPromiseWith(services)(
      Effect.gen(function* () {
        yield* Effect.promise(() => go.promise);
        return yield* Effect.promise(() => greeter.greet("p", ctx));
      }),
    ),
  );
  modules.set("greeter", greeterFacet("v2"));
  yield* Effect.promise(() => server.reload([], { remote: { "session:": ["greeter"] } }));
  assert.equal(worker.previousCodeVersion, first);
  const second = server.reload([], { remote: { "session:": [] }, retireDeadline: 2000 });
  yield* Effect.promise(() => tick());
  yield* Effect.promise(() => tick());
  assert.equal(worker.previousCodeVersion, first);
  go.open();
  assert.equal(yield* Effect.promise(() => pinned), "v1 p");
  yield* Effect.promise(() => second);
  assert.equal(server.previousCodeVersion, undefined);
});

const aChildReconciledAfterItsParent = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const modules = new Map<string, Facet>([["greeter", greeterFacet("v1")]]);
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  onTestFinished(() => server.close());
  const plugin = (): Facet => ({ name: "server-plugin", setup: () => {} });
  server.install(plugin());
  yield* Effect.promise(() => server.reload([plugin()]));
  yield* Effect.promise(() => server.reload([plugin()]));
  assert.equal(server.previousCodeVersion, undefined);
  const [down, up] = memoryLinkPair();
  server.accept(down, { principal: { worker: "w" }, kind: "host", name: "session:S1" });
  const worker = createHost({
    self: { kind: "host" },
    name: "session:S1",
    upstream: { link: up, principal: { kind: "server" } },
    loader: (names) =>
      Effect.runPromiseWith(services)(
        Effect.sync(() => {
          return names.map((name) => modules.get(String(name))!);
        }),
      ),
    onError: () => {},
  });
  onTestFinished(() => worker.close());
  worker.install(modules.get("greeter")!);
  for (let i = 0; i < 50 && worker.codeVersion !== server.codeVersion; i++)
    yield* Effect.promise(() => tick());
  assert.equal(worker.codeVersion, server.codeVersion);
  for (let i = 0; i < 20 && worker.previousCodeVersion !== undefined; i++)
    yield* Effect.promise(() => tick());
  assert.equal(worker.previousCodeVersion, undefined);
  const started = yield* Clock.currentTimeMillis;
  yield* Effect.promise(() =>
    server.reload([], { remote: { "session:": ["greeter"] }, retireDeadline: 10_000 }),
  );
  assert.ok((yield* Clock.currentTimeMillis) - started < 2000);
});

const aReconciliationRunningWhenAReload = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const modules = new Map<string, Facet>([["greeter", greeterFacet("v1")]]);
  const serverLoading = latch();
  let blockServer = false;
  const server = createHost({
    self: { kind: "host" },
    name: "server",
    onError: () => {},
    loader: (names) =>
      Effect.runPromiseWith(services)(
        Effect.gen(function* () {
          if (blockServer) yield* Effect.promise(() => serverLoading.promise);
          return names.map((name) => ({ name: String(name), setup: () => {} }));
        }),
      ),
  });
  onTestFinished(() => server.close());
  server.install({ name: "server-plugin", setup: () => {} });
  yield* Effect.promise(() =>
    server.reload(["server-plugin"], { remote: { "session:": ["greeter"] } }),
  );
  const workerLoading = latch();
  let blockWorker = true;
  const [down, up] = memoryLinkPair();
  server.accept(down, { principal: { worker: "w" }, kind: "host", name: "session:S1" });
  const worker = createHost({
    self: { kind: "host" },
    name: "session:S1",
    upstream: { link: up, principal: { kind: "server" } },
    loader: (names) =>
      Effect.runPromiseWith(services)(
        Effect.gen(function* () {
          if (blockWorker) yield* Effect.promise(() => workerLoading.promise);
          return names.map((name) => modules.get(String(name))!);
        }),
      ),
    onError: () => {},
  });
  onTestFinished(() => worker.close());
  worker.install(modules.get("greeter")!);
  yield* Effect.promise(() => tick());
  blockServer = true;
  modules.set("greeter", greeterFacet("v2"));
  const reloading = server.reload(["server-plugin"], { remote: { "session:": ["greeter"] } });
  blockWorker = false;
  workerLoading.open();
  for (let i = 0; i < 50 && worker.codeVersion !== 2; i++) yield* Effect.promise(() => tick());
  assert.equal(worker.codeVersion, 2);
  serverLoading.open();
  const report = yield* Effect.promise(() => reloading);
  assert.deepEqual(Object.keys(report.children ?? {}), []);
  assert.equal(report.codeVersion, 3);
  const greeter = server.hold(Greeter, { session: "S1" });
  assert.equal(yield* Effect.promise(() => greeter.greet("a")), "v2 a");
  assert.equal(worker.codeVersion, server.codeVersion);
});

const aChildBehindWhoseHelloWaits = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const pingFacet: Facet = {
    name: "ping",
    setup: (api) => api.serve(Ping, () => ({ variant: "main", ping: () => "pong" })),
  };
  const loading = latch();
  const server = createHost({
    self: { kind: "host" },
    name: "server",
    onError: () => {},
    loader: (names) =>
      Effect.runPromiseWith(services)(
        Effect.gen(function* () {
          yield* Effect.promise(() => loading.promise);
          return names.map((name) => ({ name: String(name), setup: () => {} }));
        }),
      ),
  });
  onTestFinished(() => server.close());
  server.install(pingFacet);
  yield* Effect.promise(() => server.reload([pingFacet]));
  assert.equal(server.previousCodeVersion, undefined, "code version 1 is retired");
  const reloading = server.reload(["server-plugin"], { remote: { "session:": [] } });
  const [down, up] = memoryLinkPair();
  server.accept(down, { principal: { worker: "w" }, kind: "host", name: "session:S1" });
  const worker = createHost({
    self: { kind: "host" },
    name: "session:S1",
    upstream: { link: up, principal: { kind: "server" } },
    onError: () => {},
  });
  onTestFinished(() => worker.close());
  const answer = yield* Effect.promise(() =>
    worker.root((ctx) =>
      Effect.runPromiseWith(services)(
        Effect.gen(function* () {
          const remote = yield* Effect.promise(() => ctx.get(Ping, {}));
          return yield* Effect.promise(() => remote.ping(ctx));
        }),
      ),
    ),
  );
  assert.equal(answer, "pong");
  loading.open();
  yield* Effect.promise(() => reloading);
  for (let i = 0; i < 50 && worker.codeVersion !== server.codeVersion; i++)
    yield* Effect.promise(() => tick());
  assert.equal(worker.codeVersion, server.codeVersion);
});

const aReconnectingChildBehindItsParent = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const modules = new Map<string, Facet>([["greeter", greeterFacet("v1")]]);
  const loader: FacetLoader = (names) =>
    Effect.runPromiseWith(services)(
      Effect.sync(() => {
        return names.map((name) => modules.get(String(name))!);
      }),
    );
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  onTestFinished(() => server.close());
  const [down, up] = memoryLinkPair();
  server.accept(
    dropping(down, (frame) => frame.t === "retire"),
    { principal: { worker: "w" }, kind: "host", name: "session:S1" },
  );
  const worker = createHost({
    self: { kind: "host" },
    name: "session:S1",
    upstream: { link: up, principal: { kind: "server" } },
    loader,
    onError: () => {},
  });
  onTestFinished(() => worker.close());
  worker.install(modules.get("greeter")!);
  yield* Effect.promise(() => tick());
  modules.set("greeter", greeterFacet("v2"));
  yield* Effect.promise(() => server.reload([], { remote: { "session:": ["greeter"] } }));
  yield* Effect.promise(() => tick());
  assert.equal(worker.previousCodeVersion, 1);
  up.close("gone");
  yield* Effect.promise(() => tick());
  modules.set("greeter", greeterFacet("v3"));
  yield* Effect.promise(() => server.reload([{ name: "server-plugin", setup: () => {} }]));
  const [down2, up2] = memoryLinkPair();
  server.accept(down2, { principal: { worker: "w" }, kind: "host", name: "session:S1" });
  const started = yield* Clock.currentTimeMillis;
  worker.connect(up2, { principal: { kind: "server" } });
  for (let i = 0; i < 400 && worker.codeVersion !== server.codeVersion; i++) yield* Effect.sleep(5);
  assert.equal(worker.codeVersion, server.codeVersion);
  const elapsed = (yield* Clock.currentTimeMillis) - started;
  assert.ok(elapsed < 2000, `reconciled after ${elapsed} ms`);
});

const forcedRetirementCancelsABrowserCall = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const log: string[] = [];
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  onTestFinished(() => server.close());
  const [down, up] = memoryLinkPair();
  const worker = createHost({
    self: { kind: "host" },
    name: "session:S1",
    upstream: { link: up, principal: { kind: "server" } },
    onError: () => {},
  });
  onTestFinished(() => worker.close());
  const never = latch();
  const Slow = remote("t.cluster-slow", {
    version: 1,
    input: Type.Object({}),
    host: hostNamed("session:S1"),
    variants: { main: { methods: { wait: method() } } },
  });
  worker.serve(Slow, () => ({
    variant: "main",
    wait: (ctx: Ctx) =>
      Effect.runPromiseWith(services)(
        Effect.gen(function* () {
          ctx.signal.addEventListener("abort", () => log.push("worker aborted"));
          yield* Effect.promise(() => never.promise);
        }),
      ),
  }));
  const watched = dropping(down, (frame) => {
    if (frame.t === "cancel") log.push("cancel sent");
    return false;
  });
  server.route("session:", {
    authorize: () => true,
    resolve: () => Effect.runPromiseWith(services)(Effect.succeed(watched)),
    principal: (name) => ({ host: name }),
  });
  const Store = local("t.cluster-store", { version: 1, input: Type.Object({}) });
  const storeFacet = (version: number): Facet => ({
    name: "store",
    setup: (api) =>
      api.serve(
        Store,
        (_input, _principal, self) => {
          self.resource("conn", {
            version,
            open: () => ({}),
            close: () => void log.push(`server closes ${version}`),
          });
          return {};
        },
        { lifetime: "host" },
      ),
  });
  yield* Effect.promise(() => server.install(storeFacet(1)));
  const [browserDown, browserUp] = memoryLinkPair();
  server.accept(browserDown, { principal: { guest: "g" } });
  const browser = createHost({
    self: { kind: "host" },
    name: "browser",
    kind: "client",
    upstream: { link: browserUp, principal: { kind: "server" } },
    onError: () => {},
  });
  onTestFinished(() => browser.close());
  const call = browser.hold(Slow, {}).wait();
  call.catch(() => {});
  for (let i = 0; i < 50 && log.length === 0 && worker.codeVersion === 0; i++)
    yield* Effect.promise(() => tick());
  yield* Effect.sleep(10);
  yield* Effect.promise(() => server.reload([storeFacet(2)]));
  yield* Effect.promise(() => server.reload([storeFacet(3)], { retireDeadline: 20 }));
  const settled = yield* Effect.promise(() =>
    Promise.race([
      call.then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise((resolve) => setTimeout(() => resolve("pending"), 2000)),
    ]),
  );
  assert.equal(settled, "rejected", "the browser's call is cancelled with its root");
  for (let i = 0; i < 50 && !log.includes("worker aborted"); i++)
    yield* Effect.promise(() => tick());
  assert.deepEqual(
    log.filter((entry) => entry === "cancel sent" || entry === "server closes 1"),
    ["cancel sent", "server closes 1"],
  );
  assert.ok(log.includes("worker aborted"));
  never.open();
});

describe("cross-host reload", () => {
  it("prepares every host, commits the server first, then the workers; code versions stay in step", () =>
    Effect.runPromise(preparesEveryHostCommitsTheServer));

  it("a failing vote aborts every host; the error keeps its code and names the host", () =>
    Effect.runPromise(aFailingVoteAbortsEveryHost));

  it("a worker gate blocked past its deadline aborts the whole reload", () =>
    Effect.runPromise(aWorkerGateBlockedPastIts));

  it("removes facets from server and workers, reconciles removal tombstones, and clears them on re-add", () =>
    Effect.runPromise(removesFacetsFromServerAndWorkers));

  it("only the server coordinates reloads", () =>
    Effect.runPromise(onlyTheServerCoordinatesReloads));

  it("browsers are not participants: they see shape and reset pushes, or upgrade_required", () =>
    Effect.runPromise(browsersAreNotParticipantsTheySee));

  it("an abort while a worker is still preparing: a late open closes itself and the worker can reload again", () =>
    Effect.runPromise(anAbortWhileAWorkerIs));

  it("a child that says hello while a reload runs is reconciled after it, never left in step with the old code", () =>
    Effect.runPromise(aChildThatSaysHelloWhile));

  it("a child keeps the previous code version until its parent retired it (spec 12)", () =>
    Effect.runPromise(aChildKeepsThePreviousCode));

  it("a child reconciled after its parent retired old code versions may retire its own previous one at once", () =>
    Effect.runPromise(aChildReconciledAfterItsParent));

  it("a reconciliation running when a reload starts syncs the child only after it, to the committed code version", () =>
    Effect.runPromise(aReconciliationRunningWhenAReload));

  it("a child behind whose hello waits for a running reload is fenced at once: its calls up are admitted (spec 9)", () =>
    Effect.runPromise(aChildBehindWhoseHelloWaits));

  it("a reconnecting child behind its parent, still retaining its previous code version, reconciles without waiting out the retire deadline", () =>
    Effect.runPromise(aReconnectingChildBehindItsParent));

  it("forced retirement cancels a browser call relayed to a worker before the server closes the old code's resources", () =>
    Effect.runPromise(forcedRetirementCancelsABrowserCall));
});
