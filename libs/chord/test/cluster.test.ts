import assert from "node:assert/strict";

import { type Context, Effect } from "effect";
import { describe, it, onTestFinished } from "vite-plus/test";

import chord from "../src/index.ts";
import type chordTypes from "../src/index.types.ts";
import cluster from "./fixtures/cluster.ts";
import timing from "./fixtures/timing.ts";

const { createHost, isChordError, memoryLinkPair } = chord;

const { Greeter, GreeterV2, ServerGreeter, greeterFacet, setup } = cluster;
const { latch, pollUntil, tick } = timing;

const preparesEveryHostCommitsTheServer = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const { server, worker, modules } = setup();
  yield* tick;
  const greeter = server.hold(Greeter, { session: "S1" });
  assert.equal(yield* Effect.promise(() => greeter.greet("a")), "v1 a");
  const go = latch();
  const pinned = server.root((ctx) =>
    Effect.runPromiseWith(services)(
      Effect.gen(function* () {
        yield* Effect.promise(() => greeter.greet("p", ctx));
        yield* go.wait;
        return yield* Effect.promise(() => greeter.greet("p", ctx));
      }),
    ),
  );
  yield* tick;
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
  yield* pollUntil(() => worker.previousCodeVersion === undefined, 20, tick);
  assert.equal(server.previousCodeVersion, undefined);
  assert.equal(worker.previousCodeVersion, undefined);
});

const aFailingVoteAbortsEveryHost = Effect.gen(function* () {
  const { server, worker, modules } = setup();
  yield* tick;
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
  yield* tick;
  const greeter = server.hold(Greeter, { session: "S1" });
  const go = latch();
  const blocker = server.root((ctx) =>
    Effect.runPromiseWith(services)(
      Effect.gen(function* () {
        yield* Effect.promise(() => greeter.greet("g", ctx));
        yield* go.wait;
      }),
    ),
  );
  yield* tick;
  const before = [server.codeVersion, worker.codeVersion];
  const bumped = greeterFacet("v2", { stateVersion: 2 });
  modules.set("greeter", bumped);
  yield* Effect.promise(() =>
    assert.rejects(
      server.reload([], { gateDeadline: 30, remote: { "session:": ["greeter"] } }),
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

const coldWorkerIsReconciled = (server: chordTypes.Host, services: Context.Context<never>) =>
  Effect.gen(function* () {
    const cold = createHost({
      loader: () =>
        Effect.runPromiseWith(services)(
          Effect.sync(() => {
            assert.fail("Removed modules must not be imported");
          }),
        ),
      name: "session:cold",
      onError: () => {},
      self: { kind: "host" },
    });
    onTestFinished(() => cold.close());
    yield* Effect.promise(() => cold.install(greeterFacet("v1")));
    const old = cold.hold(Greeter, { session: "cold" });
    yield* Effect.promise(() => old.ready);
    const [down, up] = memoryLinkPair();
    server.accept(down, { kind: "host", name: "session:cold", principal: { worker: "cold" } });
    cold.connect(up, { principal: { kind: "server" } });
    yield* pollUntil(() => old.status === "gone", 20, tick);
    assert.equal(old.status, "gone");
    assert.equal(cold.codeVersion, server.codeVersion);
    yield* Effect.promise(() => cold.close());
  });

const freshWorkerLoadsCurrentCode = (
  server: chordTypes.Host,
  modules: Map<string, chordTypes.Facet>,
  services: Context.Context<never>,
) =>
  Effect.gen(function* () {
    const fresh = createHost({
      loader: (names) =>
        Effect.runPromiseWith(services)(
          Effect.sync(() => names.map((name) => modules.get(String(name))!)),
        ),
      name: "session:fresh",
      onError: () => {},
      self: { kind: "host" },
    });
    onTestFinished(() => fresh.close());
    yield* Effect.promise(() => fresh.install(greeterFacet("v1")));
    const [freshDown, freshUp] = memoryLinkPair();
    server.accept(freshDown, {
      kind: "host",
      name: "session:fresh",
      principal: { worker: "fresh" },
    });
    fresh.connect(freshUp, { principal: { kind: "server" } });
    assert.equal(
      yield* Effect.promise(() => server.hold(Greeter, { session: "fresh" }).greet("c")),
      "v2 c",
    );
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
  yield* tick;
  const onServer = server.hold(ServerGreeter, {});
  const child = server.hold(Greeter, { session: "S1" });
  assert.equal(yield* Effect.promise(() => onServer.greet("a")), "v1 a");
  assert.equal(yield* Effect.promise(() => child.greet("a")), "v1 a");
  yield* Effect.promise(() =>
    server.reload([], { remoteRemove: { "session:": ["greeter"] }, remove: ["greeter"] }),
  );
  yield* pollUntil(() => child.status === "gone", 20, tick);
  assert.equal(onServer.status, "gone");
  assert.equal(child.status, "gone");

  yield* coldWorkerIsReconciled(server, services);
  modules.set("greeter", greeterFacet("v2"));
  yield* Effect.promise(() =>
    server.reload([greeterFacet("v2")], { remote: { "session:": ["greeter"] } }),
  );
  assert.equal(
    yield* Effect.promise(() => server.hold(Greeter, { session: "S1" }).greet("b")),
    "v2 b",
  );
  yield* freshWorkerLoadsCurrentCode(server, modules, services);
});

const onlyTheServerCoordinatesReloads = Effect.gen(function* () {
  const { worker } = setup();
  yield* tick;
  yield* Effect.promise(() =>
    assert.rejects(worker.reload([]), (error) => isChordError(error, "unavailable")),
  );
});

const browsersAreNotParticipantsTheySee = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const { server, modules, down: workerLink } = setup();
  server.route("session:", {
    authorize: () => true,
    principal: (name) => ({ host: name }),
    resolve: () => Effect.runPromiseWith(services)(Effect.sync(() => workerLink)),
  });
  const [down, up] = memoryLinkPair();
  server.accept(down, { principal: { guest: "g" } });
  const browser = createHost({
    kind: "client",
    name: "browser",
    onError: () => {},
    self: { kind: "host" },
    upstream: { link: up, principal: { kind: "server" } },
  });
  const viewer = browser.hold(Greeter, { session: "S1" });
  assert.equal(yield* Effect.promise(() => viewer.greet("a")), "v1 a");
  const shapes: string[] = [];
  viewer.onShape((shape) => shapes.push(shape.contract));
  modules.set("greeter", greeterFacet("v2"));
  yield* Effect.promise(() => server.reload([], { remote: { "session:": ["greeter"] } }));
  yield* pollUntil(() => shapes.length !== 0, 20, tick);
  assert.equal(shapes.length, 1, "one shape push at the commit");
  assert.equal(yield* Effect.promise(() => viewer.greet("b")), "v2 b");

  modules.set("greeter", {
    name: "greeter",
    setup: (api) =>
      api.serve(GreeterV2, () => ({
        hello: (name: string) => `hi ${name}`,
        variant: "main",
      })),
  });
  yield* Effect.promise(() => server.reload([], { remote: { "session:": ["greeter"] } }));
  yield* pollUntil(() => viewer.status === "gone", 20, tick);
  assert.equal(viewer.status, "gone");
  assert.ok(isChordError(viewer.error, "upgrade_required"));
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
});
