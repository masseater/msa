import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import { createHost, hostNamed, memoryLinkPair, remote } from "../src/index.ts";
import { Counter, cluster, internals, until } from "./fixtures/links-review.ts";
import { latch } from "./fixtures/timing.ts";

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

const case11SnapshotsThroughAnAcceptsAdapter = Effect.gen(function* () {
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
