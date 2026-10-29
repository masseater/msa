import assert from "node:assert/strict";

import { Clock, type Context, Effect } from "effect";
import { Type } from "typebox";
import { describe, it, onTestFinished } from "vite-plus/test";

import chord from "../src/index.ts";
import type chordTypes from "../src/index.types.ts";
import cluster from "./fixtures/cluster.ts";
import timing from "./fixtures/timing.ts";

const { createHost, isChordError, memoryLinkPair } = chord;

const { Greeter, greeterFacet, setup } = cluster;
const { latch, pollUntil, tick } = timing;

const anAbortWhileAWorkerIs = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const { server, worker, modules } = setup();
  yield* tick;
  const greeter = server.hold(Greeter, { session: "S1" });
  yield* Effect.promise(() => greeter.greet("a"));
  const log: string[] = [];
  const go = latch();
  const slow: chordTypes.Facet = {
    name: "greeter",
    setup: (api) =>
      api.serve(Greeter, (_input, _principal, self) => {
        self.resource("late", {
          close: () => void log.push("closed"),
          open: () =>
            Effect.runPromiseWith(services)(
              Effect.gen(function* () {
                yield* go.wait;
                log.push("opened");
              }),
            ),
          version: 1,
        });
        const count = self.state("count", Type.Object({ n: Type.Number() }), { n: 0 });
        return { count, greet: (name: string) => `slow ${name}`, variant: "main" };
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
  yield* pollUntil(() => log.includes("closed"), 50, tick);
  assert.deepEqual(log, ["opened", "closed"]);
  assert.equal(worker.codeVersion, codeVersion);
  modules.set("greeter", greeterFacet("v3"));
  yield* Effect.promise(() => server.reload([], { remote: { "session:": ["greeter"] } }));
  assert.equal(yield* Effect.promise(() => greeter.greet("b")), "v3 b");
});

const aChildThatSaysHelloWhile = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const modules = new Map<string, chordTypes.Facet>([["greeter", greeterFacet("v1")]]);
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
  const reloading = server.reload(["server-plugin"], { remote: { "session:": ["greeter"] } });
  const [down, up] = memoryLinkPair();
  server.accept(down, { kind: "host", name: "session:S1", principal: { worker: "w" } });
  const worker = createHost({
    loader: (names) =>
      Effect.runPromiseWith(services)(
        Effect.sync(() => names.map((name) => modules.get(String(name))!)),
      ),
    name: "session:S1",
    onError: () => {},
    self: { kind: "host" },
    upstream: { link: up, principal: { kind: "server" } },
  });
  onTestFinished(() => worker.close());
  worker.install(modules.get("greeter")!);
  yield* tick;
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
  yield* tick;
  const greeter = server.hold(Greeter, { session: "S1" });
  assert.equal(yield* Effect.promise(() => greeter.greet("a")), "v1 a");
  const first = server.codeVersion;
  const go = latch();
  const pinned = server.root((ctx) =>
    Effect.runPromiseWith(services)(
      Effect.gen(function* () {
        yield* go.wait;
        return yield* Effect.promise(() => greeter.greet("p", ctx));
      }),
    ),
  );
  modules.set("greeter", greeterFacet("v2"));
  yield* Effect.promise(() => server.reload([], { remote: { "session:": ["greeter"] } }));
  assert.equal(worker.previousCodeVersion, first);
  const second = server.reload([], { remote: { "session:": [] }, retireDeadline: 2000 });
  yield* tick;
  yield* tick;
  assert.equal(worker.previousCodeVersion, first);
  go.open();
  assert.equal(yield* Effect.promise(() => pinned), "v1 p");
  yield* Effect.promise(() => second);
  assert.equal(server.previousCodeVersion, undefined);
});

const aChildReconciledAfterItsParent = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const modules = new Map<string, chordTypes.Facet>([["greeter", greeterFacet("v1")]]);
  const server = createHost({ name: "server", onError: () => {}, self: { kind: "host" } });
  onTestFinished(() => server.close());
  const plugin = (): chordTypes.Facet => ({ name: "server-plugin", setup: () => {} });
  server.install(plugin());
  yield* Effect.promise(() => server.reload([plugin()]));
  yield* Effect.promise(() => server.reload([plugin()]));
  assert.equal(server.previousCodeVersion, undefined);
  const [down, up] = memoryLinkPair();
  server.accept(down, { kind: "host", name: "session:S1", principal: { worker: "w" } });
  const worker = createHost({
    loader: (names) =>
      Effect.runPromiseWith(services)(
        Effect.sync(() => names.map((name) => modules.get(String(name))!)),
      ),
    name: "session:S1",
    onError: () => {},
    self: { kind: "host" },
    upstream: { link: up, principal: { kind: "server" } },
  });
  onTestFinished(() => worker.close());
  worker.install(modules.get("greeter")!);
  yield* pollUntil(() => worker.codeVersion === server.codeVersion, 50, tick);
  assert.equal(worker.codeVersion, server.codeVersion);
  yield* pollUntil(() => worker.previousCodeVersion === undefined, 20, tick);
  assert.equal(worker.previousCodeVersion, undefined);
  const started = yield* Clock.currentTimeMillis;
  yield* Effect.promise(() =>
    server.reload([], { remote: { "session:": ["greeter"] }, retireDeadline: 10_000 }),
  );
  assert.ok((yield* Clock.currentTimeMillis) - started < 2000);
});

interface BlockedWorker {
  readonly worker: chordTypes.Host;
  readonly releaseLoading: () => void;
}

const blockedWorker = (
  server: chordTypes.Host,
  modules: Map<string, chordTypes.Facet>,
  services: Context.Context<never>,
): BlockedWorker => {
  const workerLoading = latch();
  let blockWorker = true;
  const [down, up] = memoryLinkPair();
  server.accept(down, { kind: "host", name: "session:S1", principal: { worker: "w" } });
  const worker = createHost({
    loader: (names) =>
      Effect.runPromiseWith(services)(
        Effect.gen(function* () {
          if (blockWorker) yield* workerLoading.wait;
          return names.map((name) => modules.get(String(name))!);
        }),
      ),
    name: "session:S1",
    onError: () => {},
    self: { kind: "host" },
    upstream: { link: up, principal: { kind: "server" } },
  });
  onTestFinished(() => worker.close());
  worker.install(modules.get("greeter")!);
  return {
    releaseLoading: () => {
      blockWorker = false;
      workerLoading.open();
    },
    worker,
  };
};

const aReconciliationRunningWhenAReload = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const modules = new Map<string, chordTypes.Facet>([["greeter", greeterFacet("v1")]]);
  const serverLoading = latch();
  let blockServer = false;
  const server = createHost({
    loader: (names) =>
      Effect.runPromiseWith(services)(
        Effect.gen(function* () {
          if (blockServer) yield* serverLoading.wait;
          return names.map((name) => ({ name: String(name), setup: () => {} }));
        }),
      ),
    name: "server",
    onError: () => {},
    self: { kind: "host" },
  });
  onTestFinished(() => server.close());
  server.install({ name: "server-plugin", setup: () => {} });
  yield* Effect.promise(() =>
    server.reload(["server-plugin"], { remote: { "session:": ["greeter"] } }),
  );
  const { worker, releaseLoading } = blockedWorker(server, modules, services);
  yield* tick;
  blockServer = true;
  modules.set("greeter", greeterFacet("v2"));
  const reloading = server.reload(["server-plugin"], { remote: { "session:": ["greeter"] } });
  releaseLoading();
  yield* pollUntil(() => worker.codeVersion === 2, 50, tick);
  assert.equal(worker.codeVersion, 2);
  serverLoading.open();
  const report = yield* Effect.promise(() => reloading);
  assert.deepEqual(Object.keys(report.children ?? {}), []);
  assert.equal(report.codeVersion, 3);
  const greeter = server.hold(Greeter, { session: "S1" });
  assert.equal(yield* Effect.promise(() => greeter.greet("a")), "v2 a");
  assert.equal(worker.codeVersion, server.codeVersion);
});

describe("cross-host reload", () => {
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
});
