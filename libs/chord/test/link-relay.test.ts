import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import {
  createHost,
  type Frame,
  hostNamed,
  isChordError,
  memoryLinkPair,
  method,
  PROTOCOL_VERSION,
  remote,
} from "../src/index.ts";
import {
  Counter,
  SessionCounter,
  cluster,
  serveCounter,
  serverWithWorker,
} from "./fixtures/link.ts";
import { tick } from "./fixtures/timing.ts";

const relaysBrowserServerWorkerTheWorker = Effect.gen(function* () {
  const c = cluster();
  const guest = { guest: "g1" };
  const browser = c.browser(guest);
  const counter = browser.host.hold(SessionCounter, { session: "S1", name: "a" });
  assert.equal(yield* Effect.promise(() => counter.add(3)), 3);
  assert.deepEqual(yield* Effect.promise(() => counter.who()), guest);
  const values: unknown[] = [];
  counter.count.subscribe((value) => values.push(value));
  yield* Effect.promise(() => counter.add(1));
  yield* tick;
  assert.deepEqual(values.at(-1), { n: 4 });
});

const ignoresPayloadPrincipalsFromClientsAnd = Effect.gen(function* () {
  const c = cluster();
  const guest = { guest: "g1" };
  const [down, raw] = memoryLinkPair();
  c.server.accept(down, { principal: guest });
  const frames: Frame[] = [];
  raw.receive((frame) => frames.push(frame));
  raw.send({
    t: "hello",
    protocol: PROTOCOL_VERSION,
    name: "raw",
    kind: "client",
    codeVersion: 0,
  });
  raw.send({
    t: "hold",
    id: 1,
    at: "session:S1",
    token: SessionCounter.description,
    input: { session: "S1", name: "f" },
    principal: { owner: true },
  });
  raw.send({ t: "call", id: 2, hold: 1, member: "who", args: null });
  for (let i = 0; i < 50 && !frames.some((frame) => frame.t === "result"); i++)
    yield* Effect.sleep(5);
  const result = frames.find((frame) => frame.t === "result");
  assert.deepEqual(result?.t === "result" ? result.value : undefined, guest);

  const { server, down: _down, up } = serverWithWorker("w9");
  serveCounter(server);
  const childFrames: Frame[] = [];
  up.receive((frame) => childFrames.push(frame));
  up.send({
    t: "hold",
    id: 7,
    at: "server",
    token: Counter.description,
    input: { name: "f" },
    principal: { owner: true },
  });
  up.send({ t: "call", id: 8, hold: 7, member: "who", args: null });
  for (let i = 0; i < 50 && !childFrames.some((frame) => frame.t === "result"); i++)
    yield* Effect.sleep(5);
  const childResult = childFrames.find((frame) => frame.t === "result");
  assert.deepEqual(childResult?.t === "result" ? childResult.value : undefined, {
    worker: "w9",
  });
});

const aRouteThatReturnsAnAlready = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  let attempt = 0;
  server.route("session:", {
    principal: (name) => ({ host: name }),
    authorize: () => true,
    resolve: (name) =>
      Effect.runPromiseWith(services)(
        Effect.sync(() => {
          attempt++;
          const [down, up] = memoryLinkPair();
          const worker = createHost({
            self: { kind: "host" },
            name,
            upstream: { link: up, principal: { kind: "server" } },
            onError: () => {},
          });
          serveCounter(worker);
          if (attempt === 1) down.close("worker exited");
          return down;
        }),
      ),
  });
  const first = server.hold(SessionCounter, { session: "S1", name: "a" });
  yield* Effect.promise(() =>
    assert.rejects(first.add(1), (error: Error) => /closed/u.test(error.message)),
  );
  const second = server.hold(SessionCounter, { session: "S1", name: "a" });
  assert.equal(yield* Effect.promise(() => second.add(2)), 2);
  assert.equal(attempt, 2);
});

const authorizesBeforeResolvingAndAgainAfter = Effect.gen(function* () {
  const c = cluster();
  c.allow = (principal) => (principal as { guest: string }).guest !== "blocked";
  const blocked = c.browser({ guest: "blocked" });
  yield* Effect.promise(() =>
    assert.rejects(blocked.host.hold(SessionCounter, { session: "S1", name: "a" }).ready, (error) =>
      isChordError(error, "forbidden"),
    ),
  );
  assert.equal(c.workers.size, 0);
  let calls = 0;
  c.allow = () => ++calls === 1;
  const flaky = c.browser({ guest: "flaky" });
  yield* Effect.promise(() =>
    assert.rejects(flaky.host.hold(SessionCounter, { session: "S2", name: "a" }).ready, (error) =>
      isChordError(error, "forbidden"),
    ),
  );
  assert.equal(calls, 2);
});

const aBrowserDisconnectReleasesExactlyIts = Effect.gen(function* () {
  const c = cluster();
  const one = c.browser({ guest: "g1" });
  const two = c.browser({ guest: "g2" });
  yield* Effect.promise(() => one.host.hold(SessionCounter, { session: "S1", name: "a" }).add(1));
  const other = two.host.hold(SessionCounter, { session: "S1", name: "b" });
  yield* Effect.promise(() => other.add(1));
  one.up.close();
  for (let i = 0; i < 20 && !c.log.includes("close a"); i++) yield* tick;
  assert.ok(c.log.includes("close a"));
  assert.ok(!c.log.includes("close b"));
  assert.equal(yield* Effect.promise(() => other.add(1)), 2);
});

const aDeadLinkNoPongsIs = Effect.gen(function* () {
  const c = cluster({ pingInterval: 10, pingTimeout: 40 });
  const browser = c.browser({ guest: "g1" });
  yield* Effect.promise(() =>
    browser.host.hold(SessionCounter, { session: "S1", name: "a" }).add(1),
  );
  browser.up.sever();
  for (let i = 0; i < 40 && !c.log.includes("close a"); i++) yield* Effect.sleep(10);
  assert.ok(c.log.includes("close a"));
});

const checksContractTokensAcrossLinksContract = Effect.gen(function* () {
  const CounterV2 = remote("t.counter", {
    version: 2,
    input: Type.Object({ name: Type.String() }),
    host: hostNamed("server"),
    variants: { main: { methods: { inc: method(undefined, Type.Number()) } } },
  });
  const { server, worker } = serverWithWorker();
  server.serve(CounterV2, () => ({ variant: "main", inc: () => 1 }));
  yield* Effect.promise(() =>
    assert.rejects(worker.hold(Counter, { name: "x" }).ready, (error) =>
      isChordError(error, "contract_mismatch"),
    ),
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
  yield* Effect.promise(() =>
    assert.rejects(browser.hold(Counter, { name: "x" }).ready, (error) =>
      isChordError(error, "upgrade_required"),
    ),
  );
});

const invalidateprincipalReStampsTheLinkAnd = Effect.gen(function* () {
  const c = cluster();
  const browser = c.browser(
    { guest: "g1", revision: 1 },
    { restamp: (p) => ({ ...(p as object), revision: 2 }) },
  );
  const counter = browser.host.hold(SessionCounter, { session: "S1", name: "a" });
  yield* Effect.promise(() => counter.add(1));
  yield* Effect.promise(() => c.server.invalidatePrincipal({ guest: "g1" }));
  for (let i = 0; i < 20 && counter.status !== "gone"; i++) yield* tick;
  assert.equal(counter.status, "gone");
  for (let i = 0; i < 20 && !c.log.includes("close a"); i++) yield* tick;
  assert.ok(c.log.includes("close a"));
  const again = browser.host.hold(SessionCounter, { session: "S1", name: "a" });
  assert.deepEqual(yield* Effect.promise(() => again.who()), { guest: "g1", revision: 2 });
});

const afterAReconnectStateSubscribersGet = Effect.gen(function* () {
  const c = cluster();
  const browser = c.browser({ guest: "g1" });
  const counter = browser.host.hold(SessionCounter, { session: "S1", name: "r" });
  const events: string[] = [];
  counter.count.events((event) => events.push(event.type));
  yield* Effect.promise(() => counter.add(2));
  browser.up.close();
  yield* tick;
  yield* tick;
  assert.equal(counter.status, "loading");
  browser.reconnect();
  assert.equal(yield* Effect.promise(() => counter.add(1)), 1);
  yield* tick;
  assert.deepEqual(counter.count.value, { n: 1 });
  assert.equal(events[0], "snap");
  assert.ok(events.includes("reset"));
});

describe("links: relay, stamping, lifetime", () => {
  it("relays browser → server → worker; the worker sees the browser's stamped principal", () =>
    Effect.runPromise(relaysBrowserServerWorkerTheWorker));

  it("ignores payload principals from clients and from child hosts", () =>
    Effect.runPromise(ignoresPayloadPrincipalsFromClientsAnd));

  it("a route that returns an already closed link does not poison the host name", () =>
    Effect.runPromise(aRouteThatReturnsAnAlready));

  it("authorizes before resolving and again after", () =>
    Effect.runPromise(authorizesBeforeResolvingAndAgainAfter));

  it("a browser disconnect releases exactly its holds; the worker link stays up", () =>
    Effect.runPromise(aBrowserDisconnectReleasesExactlyIts));

  it("a dead link (no pongs) is closed and everything held through it is released", () =>
    Effect.runPromise(aDeadLinkNoPongsIs));

  it("checks contract tokens across links: contract_mismatch for hosts, upgrade_required for browsers", () =>
    Effect.runPromise(checksContractTokensAcrossLinksContract));

  it("invalidatePrincipal re-stamps the link and propagates to workers", () =>
    Effect.runPromise(invalidateprincipalReStampsTheLinkAnd));

  it("after a reconnect, state subscribers get a reset and calls work again", () =>
    Effect.runPromise(afterAReconnectStateSubscribersGet));
});
