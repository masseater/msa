import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import chord from "../src/index.ts";
import type chordTypes from "../src/index.types.ts";
import linksReview from "./fixtures/links-review.ts";
import timing from "./fixtures/timing.ts";

const { PROTOCOL_VERSION, createHost, hostNamed, isChordError, memoryLinkPair, method, remote } =
  chord;

const { Counter, cluster, until } = linksReview;
const { latch } = timing;

const case1TheAcceptorDecidesWhatA = Effect.gen(function* () {
  const c = cluster();
  const [down, raw] = memoryLinkPair();
  c.server.accept(down, { principal: { guest: "g" } });
  raw.receive(() => {});
  raw.send({ codeVersion: 1, kind: "host", name: "session:S9", t: "hello" });
  yield* until(() => raw.closed);
  assert.throws(
    () => c.server.accept(memoryLinkPair()[0], { kind: "host", principal: {} }),
    /needs its name/u,
  );
});

const Echo = remote("t.echo", {
  host: hostNamed("server"),
  input: Type.Object({}),
  variants: { main: { methods: { root: method(undefined, Type.String()) } } },
  version: 1,
});

const rootEchoFacet = (version: number): chordTypes.Facet => ({
  name: "echo",
  setup: (api) =>
    api.serve(Echo, (_input, _principal, self) => {
      self.state("n", Type.Number(), 0, { version });
      return { root: (ctx: chordTypes.Ctx) => ctx.rootId, variant: "main" };
    }),
});

const case1RootEndIsHonoredOnly = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const server = createHost({ name: "server", onError: () => {}, self: { kind: "host" } });
  server.install(rootEchoFacet(1));
  const [down, up] = memoryLinkPair();
  server.accept(down, { kind: "host", name: "w", principal: { worker: "w" } });
  const worker = createHost({
    name: "w",
    onError: () => {},
    self: { kind: "host" },
    upstream: { link: up, principal: { kind: "server" } },
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
    codeVersion: 0,
    kind: "client",
    name: "raw",
    protocol: PROTOCOL_VERSION,
    t: "hello",
  });
  raw.send({ rootId, t: "root_end" });
  yield* Effect.sleep(10);
  yield* Effect.promise(() =>
    assert.rejects(server.reload([rootEchoFacet(2)], { gateDeadline: 40 }), (error) => {
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
  first.raw.send({ hold: 1, t: "call" } as never);
  yield* until(() => first.raw.closed);
  const second = c.raw({ guest: "g" });
  const token = Counter.description;
  second.raw.send({ at: "session:S1", id: 1, input: { name: "a" }, t: "hold", token });
  second.raw.send({ at: "session:S1", id: 1, input: { name: "b" }, t: "hold", token });
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
