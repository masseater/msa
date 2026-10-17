import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import {
  type Ctx,
  createHost,
  type Facet,
  type FacetLoader,
  type Frame,
  type Host,
  hostNamed,
  isChordError,
  type Link,
  local,
  memoryLinkPair,
  method,
  PROTOCOL_VERSION,
  remote,
} from "../src/index.ts";
import { latch, pollUntil, tick } from "./fixtures/timing.ts";

const until = (check: () => boolean, attempts = 100) => pollUntil(check, attempts, Effect.sleep(2));

class WatchedLink implements Link {
  readonly inner: Link;
  readonly sent: Frame[] = [];
  closeOn: ((frame: Frame) => boolean) | undefined;
  constructor(inner: Link) {
    this.inner = inner;
  }
  get closed(): boolean {
    return this.inner.closed;
  }
  send(frame: Frame): number | undefined {
    this.sent.push(frame);
    if (this.closeOn?.(frame) === true) {
      this.inner.close("dropped");
      return undefined;
    }
    return this.inner.send(frame);
  }
  receive(handler: (frame: Frame) => void): void {
    this.inner.receive(handler);
  }
  onClose(handler: (reason: string) => void): void {
    this.inner.onClose(handler);
  }
  close(reason?: string): void {
    this.inner.close(reason);
  }
}

const Counter = remote("t.counter", {
  version: 1,
  input: Type.Object({ name: Type.String() }),
  host: hostNamed("session:S1"),
  variants: {
    main: {
      state: { count: Type.Object({ n: Type.Number() }) },
      methods: {
        add: method(Type.Number(), Type.Number()),
        who: method(undefined, Type.Unknown()),
        slow: method(),
      },
    },
  },
});

function cluster() {
  const log: string[] = [];
  const principals: unknown[] = [];
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  const workers = new Map<string, { host: Host; link: WatchedLink }>();
  const state = {
    server,
    log,
    principals,
    workers,
    resolveGate: undefined as Promise<void> | undefined,
    slowGate: latch(),
    browser(principal: unknown, restamp?: (p: unknown) => unknown | undefined) {
      const [down, up] = memoryLinkPair();
      server.accept(down, { principal, ...(restamp === undefined ? {} : { restamp }) });
      return {
        host: createHost({
          self: { kind: "host" },
          name: "browser",
          kind: "client",
          upstream: { link: up, principal: { kind: "server" } },
          onError: () => {},
        }),
        up,
      };
    },
    raw(principal: unknown) {
      const [down, raw] = memoryLinkPair();
      server.accept(down, { principal });
      const frames: Frame[] = [];
      raw.receive((frame) => frames.push(frame));
      raw.send({
        t: "hello",
        protocol: PROTOCOL_VERSION,
        name: "raw",
        kind: "client",
        codeVersion: 0,
      });
      return { raw, frames };
    },
  };
  server.route("session:", {
    principal: (name) => ({ host: name }),
    authorize: () => true,
    resolve: (name) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const services = yield* Effect.context<never>();
          yield* Effect.promise(() => Promise.resolve(state.resolveGate));
          const existing = workers.get(name);
          if (existing !== undefined) return existing.link;
          const [down, up] = memoryLinkPair();
          const link = new WatchedLink(down);
          const worker = createHost({
            self: { kind: "host" },
            name,
            upstream: { link: up, principal: { kind: "server" } },
            onError: () => {},
          });
          worker.serve(Counter, (input, principal, self) => {
            principals.push(principal);
            self.resource("probe", {
              version: 1,
              open: () => void log.push(`open ${input.name}`),
              close: () => void log.push(`close ${input.name}`),
            });
            const count = self.state("count", Type.Object({ n: Type.Number() }), { n: 0 });
            return {
              variant: "main",
              count,
              add: (delta: number, ctx: Ctx) => {
                count.change(ctx, (draft) => {
                  draft.n += delta;
                });
                return count.value.n;
              },
              who: () => principal,
              slow: (ctx: Ctx) =>
                Effect.runPromiseWith(services)(
                  Effect.gen(function* () {
                    ctx.signal.addEventListener("abort", () => log.push("slow aborted"));
                    yield* Effect.promise(() => state.slowGate.promise);
                  }),
                ),
            };
          });
          workers.set(name, { host: worker, link });
          return link;
        }),
      ),
  });
  return state;
}

const internals = (host: Host) =>
  host as unknown as {
    connections: Set<{
      role: string;
      peer: { kind: string; name?: string };
      relayedRefs: Map<number, unknown>;
      relayedSubs: Map<number, unknown>;
      relayedCalls: Map<number, unknown>;
    }>;
    reloading: boolean;
  };

const case1TheAcceptorDecidesWhatA = Effect.gen(function* () {
  const c = cluster();
  const [down, raw] = memoryLinkPair();
  c.server.accept(down, { principal: { guest: "g" } });
  raw.receive(() => {});
  raw.send({ t: "hello", name: "session:S9", kind: "host", codeVersion: 1 });
  yield* until(() => raw.closed);
  assert.throws(
    () => c.server.accept(memoryLinkPair()[0], { principal: {}, kind: "host" }),
    /needs its name/u,
  );
});

const case1RootEndIsHonoredOnly = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  const Echo = remote("t.echo", {
    version: 1,
    input: Type.Object({}),
    host: hostNamed("server"),
    variants: { main: { methods: { root: method(undefined, Type.String()) } } },
  });
  const facet = (version: number): Facet => ({
    name: "echo",
    setup: (api) =>
      api.serve(Echo, (_input, _principal, self) => {
        self.state("n", Type.Number(), 0, { version });
        return { variant: "main", root: (ctx: Ctx) => ctx.rootId };
      }),
  });
  server.install(facet(1));
  const [down, up] = memoryLinkPair();
  server.accept(down, { principal: { worker: "w" }, kind: "host", name: "w" });
  const worker = createHost({
    self: { kind: "host" },
    name: "w",
    upstream: { link: up, principal: { kind: "server" } },
    onError: () => {},
  });
  const go = latch();
  let rootId = "";
  const pinned = worker.root((ctx) =>
    Effect.runPromiseWith(services)(
      Effect.gen(function* () {
        const echoRef = yield* Effect.promise(() => ctx.get(Echo, {}));
        rootId = (yield* Effect.promise(() => echoRef.root(ctx))) as string;
        yield* go.wait;
      }),
    ),
  );
  yield* until(() => rootId !== "");
  const [clientDown, raw] = memoryLinkPair();
  server.accept(clientDown, { principal: { guest: "g" } });
  raw.receive(() => {});
  raw.send({
    t: "hello",
    protocol: PROTOCOL_VERSION,
    name: "raw",
    kind: "client",
    codeVersion: 0,
  });
  raw.send({ t: "root_end", rootId });
  yield* Effect.sleep(10);
  yield* Effect.promise(() =>
    assert.rejects(server.reload([facet(2)], { gateDeadline: 40 }), (error) => {
      assert.ok(isChordError(error, "aborted") && error.reason === "gate_deadline");
      assert.ok(error.message.includes(rootId));
      return true;
    }),
  );
  go.open();
  yield* Effect.promise(() => pinned);
});

const case2ARevocationWhileTheRoute = Effect.gen(function* () {
  const c = cluster();
  const gate = latch();
  c.resolveGate = gate.promise;
  const browser = c.browser({ guest: "g", revision: 1 }, (p) => ({
    ...(p as object),
    revision: 2,
  }));
  const counter = browser.host.hold(Counter, { name: "a" });
  yield* Effect.sleep(5);
  yield* Effect.promise(() => c.server.invalidatePrincipal({ guest: "g" }));
  yield* until(() => counter.status === "gone");
  gate.open();
  yield* Effect.sleep(10);
  assert.deepEqual(c.principals, []);
  const again = browser.host.hold(Counter, { name: "a" });
  assert.deepEqual(yield* Effect.promise(() => again.who()), { guest: "g", revision: 2 });
});

const case10MalformedFramesAndDuplicateIds = Effect.gen(function* () {
  const c = cluster();
  const first = c.raw({ guest: "g" });
  first.raw.send({ t: "call", hold: 1 } as never);
  yield* until(() => first.raw.closed);
  const second = c.raw({ guest: "g" });
  const token = Counter.description;
  second.raw.send({ t: "hold", id: 1, at: "session:S1", token, input: { name: "a" } });
  second.raw.send({ t: "hold", id: 1, at: "session:S1", token, input: { name: "b" } });
  yield* until(() => second.raw.closed);
});

describe("links review: identity and stamping", () => {
  it("#1 the acceptor decides what a peer is: a client announcing itself as a host is cut off", () =>
    Effect.runPromise(case1TheAcceptorDecidesWhatA));

  it("#1 root_end is honored only from the link the root came over", () =>
    Effect.runPromise(case1RootEndIsHonoredOnly));

  it("#2 a revocation while the route is still resolving closes the relay; no worker object is made", () =>
    Effect.runPromise(case2ARevocationWhileTheRoute));

  it("#10 malformed frames and duplicate ids close the link", () =>
    Effect.runPromise(case10MalformedFramesAndDuplicateIds));
});

const case7ABrowserDisconnectCancelsIts = Effect.gen(function* () {
  const c = cluster();
  const browser = c.browser({ guest: "g" });
  const counter = browser.host.hold(Counter, { name: "a" });
  yield* Effect.promise(() => counter.ready);
  void counter.slow().catch(() => {});
  yield* Effect.sleep(10);
  browser.up.close();
  yield* until(() => c.log.includes("slow aborted"));
  const down = [...internals(c.server).connections].find(
    (connection) => connection.peer.name === "session:S1",
  )!;
  assert.equal(down.relayedCalls.size, 0);
});

const case9StateStoppedWhileTheRoute = Effect.gen(function* () {
  const c = cluster();
  const gate = latch();
  c.resolveGate = gate.promise;
  const { raw } = c.raw({ guest: "g" });
  raw.send({
    t: "hold",
    id: 1,
    at: "session:S1",
    token: Counter.description,
    input: { name: "a" },
  });
  raw.send({ t: "unsub", hold: 1 });
  yield* Effect.sleep(5);
  gate.open();
  yield* until(
    () => c.workers.get("session:S1")?.link.sent.some((frame) => frame.t === "hold") === true,
  );
  yield* Effect.sleep(10);
  const sent = c.workers.get("session:S1")!.link.sent;
  const hold = sent.find((frame) => frame.t === "hold");
  assert.ok(hold?.t === "hold" && hold.state === false);
  assert.ok(!sent.some((frame) => frame.t === "sub" || frame.t === "unsub"));
});

const case9AReleaseWhileTheRoute = Effect.gen(function* () {
  const c = cluster();
  const gate = latch();
  c.resolveGate = gate.promise;
  const { raw, frames } = c.raw({ guest: "g" });
  raw.send({
    t: "hold",
    id: 1,
    at: "session:S1",
    token: Counter.description,
    input: { name: "a" },
  });
  raw.send({ t: "call", id: 2, hold: 1, member: "add", args: 1 });
  yield* Effect.sleep(5);
  raw.send({ t: "release", id: 1 });
  yield* until(() => frames.some((frame) => frame.t === "result" && frame.id === 2));
  const result = frames.find((frame) => frame.t === "result" && frame.id === 2);
  assert.ok(result?.t === "result" && result.error !== undefined);
  gate.open();
  yield* Effect.sleep(10);
  assert.ok(!(c.workers.get("session:S1")?.link.sent ?? []).some((frame) => frame.t === "hold"));
});

const case9AnOriginDisconnectRemovesIts = Effect.gen(function* () {
  const c = cluster();
  const browser = c.browser({ guest: "g" });
  const counter = browser.host.hold(Counter, { name: "a" });
  counter.count.subscribe(() => {});
  yield* Effect.promise(() => counter.add(1));
  const down = [...internals(c.server).connections].find(
    (connection) => connection.peer.name === "session:S1",
  )!;
  assert.equal(down.relayedRefs.size, 1);
  browser.up.close();
  yield* until(() => down.relayedRefs.size === 0);
  yield* until(() => c.log.includes("close a"));
});

const twoBrowsersShareOneWorkerConnection = Effect.gen(function* () {
  const c = cluster();
  const one = c.browser({ guest: "g1" });
  const two = c.browser({ guest: "g2" });
  const a = one.host.hold(Counter, { name: "same" });
  const b = two.host.hold(Counter, { name: "same" });
  assert.equal(yield* Effect.promise(() => a.add(1)), 1);
  assert.equal(yield* Effect.promise(() => b.add(5)), 5);
  assert.equal(c.workers.size, 1);
  assert.deepEqual(c.principals, [{ guest: "g1" }, { guest: "g2" }]);
  one.up.close();
  yield* until(() => c.log.filter((entry) => entry === "close same").length === 1);
  assert.equal(yield* Effect.promise(() => b.add(1)), 6);
});

const case11SnapshotsThroughAnAcceptsAdapter = Effect.gen(function* () {
  const DocV1 = remote("t.doc", {
    version: 1,
    input: Type.Object({}),
    host: hostNamed("server"),
    variants: { main: { state: { view: Type.Object({ text: Type.String() }) } } },
  });
  const DocV2 = remote("t.doc", {
    version: 2,
    input: Type.Object({}),
    host: hostNamed("server"),
    variants: { main: { state: { view: Type.Object({ body: Type.String() }) } } },
  });
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  server.serve(
    DocV2,
    (_input, _principal, self) => ({
      variant: "main",
      view: self.state("view", Type.Object({ body: Type.String() }), { body: "hi" }),
    }),
    {
      accepts: {
        1: (current) => {
          const view = current["view"] as {
            value: { body: string };
            events: (fn: (event: never) => void) => () => void;
          };
          const map = (value: { body: string }) => ({ text: value.body });
          return {
            variant: "main",
            view: {
              get value() {
                return map(view.value);
              },
              subscribe: (fn: (value: unknown) => void) => view.events(() => fn(map(view.value))),
              events: (fn: (event: unknown) => void) =>
                view.events((event: { type: string }) =>
                  fn({
                    type: event.type === "ops" ? "reset" : event.type,
                    value: map(view.value),
                  }),
                ),
            },
          };
        },
      },
    },
  );
  const [down, up] = memoryLinkPair();
  server.accept(down, { principal: { guest: "g" } });
  const browser = createHost({
    self: { kind: "host" },
    name: "browser",
    kind: "client",
    upstream: { link: up, principal: { kind: "server" } },
    onError: () => {},
  });
  const doc = browser.hold(DocV1, {});
  yield* Effect.promise(() => doc.ready);
  assert.deepEqual(doc.view.value, { text: "hi" });
});

describe("links review: relay ownership", () => {
  it("#7 a browser disconnect cancels its call downstream", () =>
    Effect.runPromise(case7ABrowserDisconnectCancelsIts));

  it("#9 state stopped while the route resolves is forwarded as a hold without state", () =>
    Effect.runPromise(case9StateStoppedWhileTheRoute));

  it("#9 a release while the route resolves settles waiting calls and forwards nothing", () =>
    Effect.runPromise(case9AReleaseWhileTheRoute));

  it("#9 an origin disconnect removes its relayed holds and subscriptions downstream", () =>
    Effect.runPromise(case9AnOriginDisconnectRemovesIts));

  it("two browsers share one worker connection; one leaving releases only its own holds", () =>
    Effect.runPromise(twoBrowsersShareOneWorkerConnection));

  it("#11 snapshots through an accepts adapter are validated against the consumer's schema", () =>
    Effect.runPromise(case11SnapshotsThroughAnAcceptsAdapter));
});

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
