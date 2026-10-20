import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import {
  type Ctx,
  type Facet,
  type FacetLoader,
  createHost,
  hostNamed,
  isChordError,
  local,
  memoryLinkPair,
  method,
  remote,
} from "../src/index.ts";
import linksReview from "./fixtures/links-review.ts";
import timing from "./fixtures/timing.ts";

const { WatchedLink, internals, until } = linksReview;
const { latch, tick } = timing;

const Greeter = remote("t.greeter", {
  host: hostNamed("session:S1"),
  input: Type.Object({}),
  variants: { main: { methods: { greet: method(Type.String(), Type.String()) } } },
  version: 1,
});
const greeterFacet = (greeting: string): Facet => ({
  name: "greeter",
  setup: (api) =>
    api.serve(Greeter, () => ({
      greet: (name: string) => `${greeting} ${name}`,
      variant: "main",
    })),
});

function setup(options: { slowLoad?: Promise<void> } = {}) {
  const modules = new Map<string, Facet>([["greeter", greeterFacet("v1")]]);
  const loader: FacetLoader = (names) =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.promise(() => Promise.resolve(options.slowLoad));
        return names.map((name) => modules.get(String(name))!);
      }),
    );
  const server = createHost({ name: "server", onError: () => {}, self: { kind: "host" } });
  const connect = () => {
    const [down, up] = memoryLinkPair();
    const watched = new WatchedLink(down);
    server.accept(watched, { kind: "host", name: "session:S1", principal: { worker: "w" } });
    return { up, watched };
  };
  const first = connect();
  const worker = createHost({
    loader,
    name: "session:S1",
    onError: () => {},
    self: { kind: "host" },
    upstream: { link: first.up, principal: { kind: "server" } },
  });
  worker.install(modules.get("greeter")!);
  return { connect, link: first.watched, modules, server, worker };
}

const case3AnAbortWhileTheChild = Effect.gen(function* () {
  const gate = latch();
  const { server, worker, modules } = setup({ slowLoad: gate.promise });
  yield* tick;
  modules.set("greeter", greeterFacet("v2"));
  yield* Effect.promise(() =>
    assert.rejects(
      server.reload([], { remote: { "session:": ["greeter"] }, voteDeadline: 30 }),
      (error) => isChordError(error, "aborted"),
    ),
  );
  gate.open();
  yield* until(() => !internals(worker).reloading);
  yield* Effect.promise(() => server.reload([], { remote: { "session:": ["greeter"] } }));
  assert.equal(yield* Effect.promise(() => server.hold(Greeter, {}).greet("x")), "v2 x");
});

const case3TheParentLinkDyingWhile = Effect.gen(function* () {
  const gate = latch();
  const { server, worker, modules, link } = setup({ slowLoad: gate.promise });
  yield* tick;
  modules.set("greeter", greeterFacet("v2"));
  const reload = server.reload([], { remote: { "session:": ["greeter"] } });
  yield* Effect.sleep(5);
  link.close("gone");
  yield* Effect.promise(() => assert.rejects(reload));
  gate.open();
  yield* until(() => !internals(worker).reloading);
  assert.equal(worker.codeVersion, 1);
});

const case4TasksTheCommitStartsCannot = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const { server, modules } = setup();
  yield* tick;
  const results: unknown[] = [];
  const Caller = local("t.caller", { input: Type.Object({}), version: 1 });
  const callerFacet = (active: boolean): Facet => ({
    name: "caller",
    setup: (api) =>
      api.serve(
        Caller,
        (_input, _principal, self) => {
          const greeter = self.get(Greeter, {});
          if (active) {
            self.task((ctx) =>
              Effect.runPromiseWith(services)(
                Effect.gen(function* () {
                  results.push(
                    yield* Effect.promise(() =>
                      greeter
                        .greet("t", ctx)
                        .catch((error: unknown) => (error as { code: string }).code),
                    ),
                  );
                }),
              ),
            );
          }
          return {};
        },
        { lifetime: "host" },
      ),
  });
  server.install(callerFacet(false));
  yield* Effect.sleep(10);
  modules.set("greeter", greeterFacet("v2"));
  yield* Effect.promise(() =>
    server.reload([callerFacet(true)], { remote: { "session:": ["greeter"] } }),
  );
  yield* until(() => results.length === 1);
  assert.deepEqual(results, ["v2 t"]);
});

const case5AChildThatMissedA = Effect.gen(function* () {
  const { server, worker, modules, link, connect } = setup();
  yield* tick;
  modules.set("greeter", greeterFacet("v2"));
  link.closeOn = (frame) => frame.t === "commit";
  yield* Effect.promise(() => server.reload([], { remote: { "session:": ["greeter"] } }));
  yield* until(() => !internals(worker).reloading);
  assert.notEqual(worker.codeVersion, server.codeVersion);
  const next = connect();
  worker.connect(next.up, { principal: { kind: "server" } });
  const greeter = server.hold(Greeter, {});
  assert.equal(yield* Effect.promise(() => greeter.greet("x")), "v2 x");
  assert.equal(worker.codeVersion, server.codeVersion);
});

const case6AServerRootThatBounces = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const { server, worker } = setup();
  yield* tick;
  const Echo = remote("t.echo2", {
    host: hostNamed("server"),
    input: Type.Object({}),
    variants: { main: { methods: { ping: method() } } },
    version: 1,
  });
  const Bouncer = remote("t.bouncer", {
    host: hostNamed("session:S1"),
    input: Type.Object({}),
    variants: { main: { methods: { bounce: method() } } },
    version: 1,
  });
  const echoFacet = (version: number): Facet => ({
    name: "echo",
    setup: (api) =>
      api.serve(Echo, (_input, _principal, self) => {
        self.state("n", Type.Number(), 0, { version });
        return { ping: () => {}, variant: "main" };
      }),
  });
  server.install(echoFacet(1));
  const echo = server.hold(Echo, {}, { principal: { worker: "w" } });
  yield* Effect.promise(() => echo.ready);
  worker.serve(Bouncer, () => ({
    bounce: (ctx: Ctx) =>
      Effect.runPromiseWith(services)(
        Effect.gen(function* () {
          const echoRef = yield* Effect.promise(() => ctx.get(Echo, {}));
          yield* Effect.promise(() => echoRef.ping(ctx));
        }),
      ),
    variant: "main",
  }));
  yield* Effect.promise(() => server.root((ctx) => server.hold(Bouncer, {}).bounce(ctx)));
  yield* Effect.sleep(10);
  yield* Effect.promise(() => server.reload([echoFacet(2)], { gateDeadline: 200 }));
});

describe("links review: cross-host reload", () => {
  it("#3 an abort while the child is still loading modules frees its reload slot; a later reload works", () =>
    Effect.runPromise(case3AnAbortWhileTheChild));

  it("#3 the parent link dying while the child prepares unwinds the child", () =>
    Effect.runPromise(case3TheParentLinkDyingWhile));

  it("#4 tasks the commit starts cannot reach a child before the child's commit", () =>
    Effect.runPromise(case4TasksTheCommitStartsCannot));

  it("#5 a child that missed a commit is reconciled on reconnect, never relabeled", () =>
    Effect.runPromise(case5AChildThatMissedA));

  it("#6 a server root that bounces through a worker and back ends normally (no leaked lease)", () =>
    Effect.runPromise(case6AServerRootThatBounces));
});
