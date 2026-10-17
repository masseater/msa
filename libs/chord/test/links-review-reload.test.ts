import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

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
  remote,
} from "../src/index.ts";
import { WatchedLink, internals, until } from "./fixtures/links-review.ts";
import { latch, tick } from "./fixtures/timing.ts";

describe("links review: cross-host reload", () => {
  const Greeter = remote("t.greeter", {
    version: 1,
    input: Type.Object({}),
    host: hostNamed("session:S1"),
    variants: { main: { methods: { greet: method(Type.String(), Type.String()) } } },
  });
  const greeterFacet = (greeting: string): Facet => ({
    name: "greeter",
    setup: (api) =>
      api.serve(Greeter, () => ({
        variant: "main",
        greet: (name: string) => `${greeting} ${name}`,
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
    const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
    const connect = () => {
      const [down, up] = memoryLinkPair();
      const watched = new WatchedLink(down);
      server.accept(watched, { principal: { worker: "w" }, kind: "host", name: "session:S1" });
      return { watched, up };
    };
    const first = connect();
    const worker = createHost({
      self: { kind: "host" },
      name: "session:S1",
      upstream: { link: first.up, principal: { kind: "server" } },
      loader,
      onError: () => {},
    });
    worker.install(modules.get("greeter")!);
    return { server, worker, modules, link: first.watched, connect };
  }

  it("#3 an abort while the child is still loading modules frees its reload slot; a later reload works", () =>
    Effect.runPromise(
      Effect.gen(function* () {
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
      }),
    ));

  it("#3 the parent link dying while the child prepares unwinds the child", () =>
    Effect.runPromise(
      Effect.gen(function* () {
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
      }),
    ));

  it("#4 tasks the commit starts cannot reach a child before the child's commit", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const services = yield* Effect.context<never>();
        const { server, modules } = setup();
        yield* tick;
        const results: unknown[] = [];
        const Caller = local("t.caller", { version: 1, input: Type.Object({}) });
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
      }),
    ));

  it("#5 a child that missed a commit is reconciled on reconnect, never relabeled", () =>
    Effect.runPromise(
      Effect.gen(function* () {
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
      }),
    ));

  it("#6 a server root that bounces through a worker and back ends normally (no leaked lease)", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const services = yield* Effect.context<never>();
        const { server, worker } = setup();
        yield* tick;
        const Echo = remote("t.echo2", {
          version: 1,
          input: Type.Object({}),
          host: hostNamed("server"),
          variants: { main: { methods: { ping: method() } } },
        });
        const Bouncer = remote("t.bouncer", {
          version: 1,
          input: Type.Object({}),
          host: hostNamed("session:S1"),
          variants: { main: { methods: { bounce: method() } } },
        });
        const echoFacet = (version: number): Facet => ({
          name: "echo",
          setup: (api) =>
            api.serve(Echo, (_input, _principal, self) => {
              self.state("n", Type.Number(), 0, { version });
              return { variant: "main", ping: () => {} };
            }),
        });
        server.install(echoFacet(1));
        const echo = server.hold(Echo, {}, { principal: { worker: "w" } });
        yield* Effect.promise(() => echo.ready);
        worker.serve(Bouncer, () => ({
          variant: "main",
          bounce: (ctx: Ctx) =>
            Effect.runPromiseWith(services)(
              Effect.gen(function* () {
                const echoRef = yield* Effect.promise(() => ctx.get(Echo, {}));
                yield* Effect.promise(() => echoRef.ping(ctx));
              }),
            ),
        }));
        yield* Effect.promise(() => server.root((ctx) => server.hold(Bouncer, {}).bounce(ctx)));
        yield* Effect.sleep(10);
        yield* Effect.promise(() => server.reload([echoFacet(2)], { gateDeadline: 200 }));
      }),
    ));
});
