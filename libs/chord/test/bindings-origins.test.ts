import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import { HostImpl } from "../src/host.ts";
import {
  type Ctx,
  type Frame,
  type Link,
  PROTOCOL_VERSION,
  createHost,
  hostFamily,
  memoryLinkPair,
  method,
  remote,
} from "../src/index.ts";
import bindings from "./fixtures/bindings.ts";
import counting from "./fixtures/counting.ts";
import type countingTypes from "./fixtures/counting.types.ts";
import timing from "./fixtures/timing.ts";

const { Notes, setup, until } = bindings;
const { CountingLink } = counting;
const { latch } = timing;

const Counter = remote("t.e8-counter", {
  host: hostFamily("session:", "session"),
  input: Type.Object({ session: Type.String() }),
  variants: { main: { methods: { add: method(Type.Number()) }, state: { n: Type.Number() } } },
  version: 1,
});

const serveSessionCounter = (created: HostImpl): void => {
  created.serve(Counter, (_input, _principal, self) => {
    const n = self.state("n", Type.Number(), 0);
    return {
      add: (delta: number, ctx: Ctx) => {
        n.replace(ctx, n.value + delta);
      },
      n,
      variant: "main",
    };
  });
};

function cluster() {
  const server = createHost({ name: "server", onError: () => {}, self: { kind: "host" } });
  let worker: HostImpl | undefined;
  let toWorker: countingTypes.CountingLink | undefined;
  server.route("session:", {
    authorize: () => true,
    principal: (name) => ({ host: name }),
    resolve: (name) =>
      Effect.runPromise(
        Effect.sync(() => {
          if (toWorker !== undefined) return toWorker;
          const [down, up] = memoryLinkPair();
          const created = new HostImpl({
            name,
            onError: () => {},
            self: { kind: "host" },
            upstream: { link: up, principal: { kind: "server" } },
          });
          serveSessionCounter(created);
          worker = created;
          toWorker = new CountingLink(down);
          return toWorker;
        }),
      ),
  });
  const browser = () => {
    const [down, up] = memoryLinkPair();
    server.accept(down, { principal: { guest: "g" } });
    const host = createHost({
      kind: "client",
      name: "browser",
      onError: () => {},
      self: { kind: "host" },
      upstream: { link: up, principal: { kind: "server" } },
    });
    return { host, up };
  };
  const origins = () =>
    [...(worker?.upstream?.served.values() ?? [])].map((served) =>
      served.kind === "local" ? served.origin : undefined,
    );
  return { browser, origins, sentToWorker: () => toWorker?.sent ?? [], server };
}

const aRelayedHoldCarriesItsClient = Effect.gen(function* () {
  const c = cluster();
  const one = c.browser();
  const two = c.browser();
  yield* Effect.promise(() => one.host.hold(Counter, { session: "S1" }).ready);
  yield* Effect.promise(() => two.host.hold(Counter, { session: "S1" }).ready);
  const own = c.server.hold(Counter, { session: "S1" });
  yield* Effect.promise(() => own.ready);
  const holds = c
    .sentToWorker()
    .filter((frame): frame is Extract<Frame, { t: "hold" }> => frame.t === "hold");
  assert.equal(holds.length, 3);
  const relayed = holds.filter((frame) => frame.origin !== undefined);
  assert.equal(relayed.length, 2);
  assert.notEqual(relayed[0]!.origin, relayed[1]!.origin, "two tabs, two origins");
  assert.equal(holds.filter((frame) => frame.origin === undefined).length, 1);

  const before = new Set(c.origins());
  one.up.close();
  yield* until(() => c.origins().filter((origin) => origin !== undefined).length === 1);
  const three = c.browser();
  yield* Effect.promise(() => three.host.hold(Counter, { session: "S1" }).ready);
  const after = c.origins().filter((origin) => origin !== undefined);
  assert.equal(after.length, 2);
  assert.ok(
    after.some((origin) => !before.has(origin)),
    "a new connection gets a new id",
  );
  yield* Effect.promise(() => c.server.close());
});

const anOriginAClientSendsIs = Effect.gen(function* () {
  const c = cluster();
  const [down, raw] = memoryLinkPair();
  c.server.accept(down, { principal: { guest: "g" } });
  raw.receive(() => {});
  raw.send({
    codeVersion: 0,
    kind: "client",
    name: "raw",
    protocol: PROTOCOL_VERSION,
    t: "hello",
  });
  raw.send({
    at: "session:S1",
    id: 1,
    input: { session: "S1" },
    origin: "spoofed",
    t: "hold",
    token: Counter.description,
  });
  yield* until(() => c.sentToWorker().some((frame) => frame.t === "hold"));
  const hold = c.sentToWorker().find((frame) => frame.t === "hold");
  assert.ok(hold?.t === "hold" && hold.origin !== undefined && hold.origin !== "spoofed");
  yield* Effect.promise(() => c.server.close());
});

describe("origins of client holds", () => {
  it("a relayed hold carries its client connection's id; the server's own holds carry none", () =>
    Effect.runPromise(aRelayedHoldCarriesItsClient));

  it("an origin a client sends is ignored: the server stamps its own", () =>
    Effect.runPromise(anOriginAClientSendsIs));
});

const aVersion3PeerIsRefused = Effect.gen(function* () {
  const { server, browser, link } = setup();
  yield* Effect.promise(() => browser.hold(Notes, {}).ready);
  const shape = link.received.find((frame) => frame.t === "shape");
  assert.ok(shape !== undefined && !("codeVersion" in shape));
  assert.deepEqual(shape.t === "shape" ? [...shape.state].sort() : [], ["notes", "title"]);

  const [down, raw] = memoryLinkPair();
  server.accept(down, { principal: { user: "old" } });
  const closed = latch<string>();
  (raw as Link).onClose(closed.open);
  raw.receive(() => {});
  raw.send({ codeVersion: 0, kind: "client", name: "old", protocol: 3, t: "hello" });
  assert.equal(yield* closed.wait, `protocol-version ${PROTOCOL_VERSION}`);
  assert.equal(PROTOCOL_VERSION, 4);
  yield* Effect.promise(() => browser.close());
  yield* Effect.promise(() => server.close());
});

describe("protocol version 4", () => {
  it("a version 3 peer is refused; shapes carry no code version", () =>
    Effect.runPromise(aVersion3PeerIsRefused));
});
