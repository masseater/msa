import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import {
  type Ctx,
  createHost,
  type Frame,
  type Host,
  hostFamily,
  hostNamed,
  type IpcChannel,
  ipcLink,
  isChordError,
  memoryLinkPair,
  method,
  PROTOCOL_VERSION,
  remote,
  type Self,
  type StateEvent,
} from "../src/index.ts";
import { Packed, unpack } from "../src/link.ts";
import { tick } from "./fixtures/timing.ts";

const counterVariants = {
  main: {
    state: { count: Type.Object({ n: Type.Number() }) },
    methods: {
      add: method(Type.Number(), Type.Number()),
      who: method(undefined, Type.Unknown()),
    },
  },
};
const Counter = remote("t.counter", {
  version: 1,
  input: Type.Object({ name: Type.String() }),
  host: hostNamed("server"),
  variants: counterVariants,
});
const SessionCounter = remote("t.session-counter", {
  version: 1,
  input: Type.Object({ session: Type.String(), name: Type.String() }),
  host: hostFamily("session:", "session"),
  variants: counterVariants,
});

function serveCounter(host: Host, principals: unknown[] = []) {
  const counter = (principal: unknown, self: Self) => {
    principals.push(principal);
    const count = self.state("count", Type.Object({ n: Type.Number() }), { n: 0 });
    return {
      variant: "main" as const,
      count,
      add: (delta: number, ctx: Ctx) => {
        count.change(ctx, (draft) => {
          draft.n += delta;
        });
        return count.value.n;
      },
      who: () => principal,
    };
  };
  if (host.name === "server")
    host.serve(Counter, (_input, principal, self) => counter(principal, self));
  else host.serve(SessionCounter, (_input, principal, self) => counter(principal, self));
}

function serverWithWorker(workerName = "session:S1") {
  const errors: unknown[] = [];
  const server = createHost({
    self: { kind: "host" },
    name: "server",
    onError: (error) => errors.push(error),
  });
  const [down, up] = memoryLinkPair();
  server.accept(down, { principal: { worker: workerName }, kind: "host", name: workerName });
  const worker = createHost({
    self: { kind: "host" },
    name: workerName,
    upstream: { link: up, principal: { kind: "server" } },
    onError: (error) => errors.push(error),
  });
  return { server, worker, down, up, errors };
}

const aChildCallsTheServerThe = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const { server, worker } = serverWithWorker();
  const principals: unknown[] = [];
  serveCounter(server, principals);
  const result = yield* Effect.promise(() =>
    worker.root((ctx) =>
      Effect.runPromiseWith(services)(
        Effect.gen(function* () {
          const counter = yield* Effect.promise(() => ctx.get(Counter, { name: "c" }));
          assert.equal(counter.variant, "main");
          return [
            yield* Effect.promise(() => counter.add(2, ctx)),
            yield* Effect.promise(() => counter.who(ctx)),
          ];
        }),
      ),
    ),
  );
  assert.deepEqual(result, [2, { worker: "session:S1" }]);
  assert.deepEqual(principals, [{ worker: "session:S1" }]);
});

const stateMembersSnapshotThenDeltaEncoded = Effect.gen(function* () {
  const { server, worker } = serverWithWorker();
  serveCounter(server);
  const counter = worker.hold(Counter, { name: "s" });
  const events: StateEvent<unknown>[] = [];
  const values: unknown[] = [];
  counter.count.events((event) => events.push(event));
  counter.count.subscribe((value) => values.push(value));
  yield* Effect.promise(() => counter.ready);
  yield* Effect.promise(() => counter.add(1));
  yield* Effect.promise(() => counter.add(1));
  yield* tick;
  assert.deepEqual(counter.count.value, { n: 2 });
  assert.deepEqual(
    events.map((event) => event.type),
    ["snap", "ops", "ops"],
  );
  assert.deepEqual(values, [{ n: 0 }, { n: 1 }, { n: 2 }]);
});

const theServerReachesAConnectedChild = Effect.gen(function* () {
  const { server, worker } = serverWithWorker("session:w1");
  const principals: unknown[] = [];
  serveCounter(worker, principals);
  yield* tick;
  const counter = server.hold(SessionCounter, { session: "w1", name: "x" });
  assert.equal(yield* Effect.promise(() => counter.add(5)), 5);
  assert.deepEqual(principals, [{ kind: "server" }]);
});

const rejectsLocalTypesAndUnknownHosts = Effect.gen(function* () {
  const { worker } = serverWithWorker();
  const missing = worker.hold(Counter, { name: "m" });
  yield* Effect.promise(() =>
    assert.rejects(missing.ready, (error) => isChordError(error, "unavailable")),
  );
});

describe("links: calls and state across hosts", () => {
  it("a child calls the server; the server stamps the child's principal", () =>
    Effect.runPromise(aChildCallsTheServerThe));

  it("state members: snapshot, then delta-encoded ops; values decode to the provider's", () =>
    Effect.runPromise(stateMembersSnapshotThenDeltaEncoded));

  it("the server reaches a connected child by name", () =>
    Effect.runPromise(theServerReachesAConnectedChild));

  it("rejects local types and unknown hosts", () =>
    Effect.runPromise(rejectsLocalTypesAndUnknownHosts));
});

interface Cluster {
  readonly server: Host;
  readonly workers: Map<string, Host>;
  readonly log: string[];
  browser(
    principal: unknown,
    options?: { restamp?: (principal: unknown) => unknown | undefined },
  ): {
    host: Host;
    up: ReturnType<typeof memoryLinkPair>[1];
    reconnect(): void;
  };
  allow: (principal: unknown, host: string) => boolean;
}

function cluster(options: { pingInterval?: number; pingTimeout?: number } = {}): Cluster {
  const log: string[] = [];
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  const workers = new Map<string, Host>();
  const state: Cluster = {
    server,
    workers,
    log,
    allow: () => true,
    browser(principal, browserOptions = {}) {
      const [down, up] = memoryLinkPair();
      server.accept(down, {
        principal,
        ...(browserOptions.restamp === undefined ? {} : { restamp: browserOptions.restamp }),
        ...options,
      });
      const host = createHost({
        self: { kind: "host" },
        name: "browser",
        kind: "client",
        upstream: { link: up, principal: { kind: "server" }, ...options },
        onError: () => {},
      });
      const ref = { host, up, reconnect: () => {} };
      ref.reconnect = () => {
        const [nextDown, nextUp] = memoryLinkPair();
        server.accept(nextDown, { principal });
        ref.up = nextUp;
        host.connect(nextUp, { principal: { kind: "server" } });
      };
      return ref;
    },
  };
  server.route("session:", {
    principal: (name) => ({ host: name }),
    authorize: (principal, host) => state.allow(principal, host),
    resolve: (name) =>
      Effect.runPromise(
        Effect.sync(() => {
          const [down, up] = memoryLinkPair();
          const worker = createHost({
            self: { kind: "host" },
            name,
            upstream: { link: up, principal: { kind: "server" }, ...options },
            onError: () => {},
          });
          worker.serve(SessionCounter, (input, principal, self) => {
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
            };
          });
          workers.set(name, worker);
          return down;
        }),
      ),
  });
  return state;
}

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

const Big = remote("t.big", {
  version: 1,
  input: Type.Object({}),
  host: hostNamed("session:S1"),
  variants: {
    main: {
      state: { notes: Type.Array(Type.String()) },
      methods: { echo: method(Type.Array(Type.String()), Type.Array(Type.String())) },
    },
  },
});

const large = (tag: string) =>
  Array.from({ length: 40 }, (_, i) => `${tag}${i}:${"x".repeat(4000)}`);

const travelWithoutArgsAndWithoutA = Effect.gen(function* () {
  const Tool = remote("t.tool", {
    version: 1,
    input: Type.Object({}),
    host: hostNamed("server"),
    variants: {
      main: {
        methods: {
          ping: method(),
          count: method(undefined, Type.Number()),
          note: method(Type.String()),
        },
      },
    },
  });
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  const notes: string[] = [];
  server.serve(Tool, () => ({
    variant: "main",
    ping: () => {},
    count: () => 2,
    note: (text) => {
      notes.push(text);
      return "dropped" as never;
    },
  }));
  const [down, up] = memoryLinkPair();
  server.accept(down, { principal: { guest: "g" } });
  const sent: Frame[] = [];
  const send = up.send.bind(up);
  up.send = (frame) => {
    sent.push(frame);
    return send(frame);
  };
  const browser = createHost({
    self: { kind: "host" },
    name: "browser",
    kind: "client",
    upstream: { link: up, principal: { kind: "server" } },
    onError: () => {},
  });
  const tool = browser.hold(Tool, {});
  yield* Effect.promise(() => tool.ready);
  assert.equal(yield* Effect.promise(() => tool.ping()), undefined);
  assert.equal(yield* Effect.promise(() => tool.count()), 2);
  assert.equal(yield* Effect.promise(() => tool.note("hi")), undefined);
  assert.deepEqual(notes, ["hi"]);
  const calls = sent.filter((frame) => frame.t === "call");
  assert.deepEqual(
    calls.map((frame) =>
      frame.t === "call" ? "args" in frame && frame.args !== undefined : undefined,
    ),
    [false, false, true],
  );
});

describe("links: methods without arguments or result", () => {
  it("travel without args and without a value, and resolve to the result or undefined", () =>
    Effect.runPromise(travelWithoutArgsAndWithoutA));
});

describe("links: protocol version", () => {
  const mismatches = () => {
    const seen: { local: number; peer: number | undefined }[] = [];
    return {
      seen,
      onProtocolMismatch: (versions: { local: number; peer: number | undefined }) =>
        seen.push(versions),
    };
  };

  it("a peer without a protocol version (an old client) is told and dropped; nothing it sends is served", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
        serveCounter(server);
        const accepted = mismatches();
        const [down, raw] = memoryLinkPair();
        server.accept(down, {
          principal: { guest: "g" },
          onProtocolMismatch: accepted.onProtocolMismatch,
        });
        const frames: Frame[] = [];
        let closed: string | undefined;
        raw.receive((frame) => frames.push(frame));
        raw.onClose((reason) => {
          closed = reason;
        });
        raw.send({ t: "hello", name: "old", kind: "client", codeVersion: 0 });
        raw.send({
          t: "hold",
          id: 1,
          at: "server",
          token: Counter.description,
          input: { name: "c" },
        });
        yield* tick;
        assert.deepEqual(accepted.seen, [{ local: PROTOCOL_VERSION, peer: 1 }]);
        assert.equal(closed, `protocol-version ${PROTOCOL_VERSION}`);
        assert.equal(down.closed, true);
        assert(
          !frames.some((frame) => frame.t === "shape"),
          "the old client's hold was not served",
        );
      }),
    ));

  it("a client learns that its server speaks another version, and stops", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const client = mismatches();
        const [down, up] = memoryLinkPair();
        const browser = createHost({
          self: { kind: "host" },
          name: "browser",
          kind: "client",
          onError: () => {},
        });
        browser.connect(up, {
          principal: { kind: "server" },
          onProtocolMismatch: client.onProtocolMismatch,
        });
        down.send({
          t: "hello",
          protocol: PROTOCOL_VERSION + 1,
          name: "server",
          kind: "host",
          codeVersion: 1,
        });
        yield* tick;
        assert.deepEqual(client.seen, [{ local: PROTOCOL_VERSION, peer: PROTOCOL_VERSION + 1 }]);
        assert.equal(up.closed, true);

        const told = mismatches();
        const [down2, up2] = memoryLinkPair();
        const other = createHost({
          self: { kind: "host" },
          name: "browser",
          kind: "client",
          onError: () => {},
        });
        other.connect(up2, {
          principal: { kind: "server" },
          onProtocolMismatch: told.onProtocolMismatch,
        });
        down2.close(`protocol-version ${PROTOCOL_VERSION + 1}`);
        yield* tick;
        assert.deepEqual(told.seen, [{ local: PROTOCOL_VERSION, peer: PROTOCOL_VERSION + 1 }]);
      }),
    ));

  it("peers of the same version talk; an ordinary close is no mismatch", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const both = mismatches();
        const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
        const [down, up] = memoryLinkPair();
        server.accept(down, {
          principal: { guest: "g" },
          onProtocolMismatch: both.onProtocolMismatch,
        });
        const browser = createHost({
          self: { kind: "host" },
          name: "browser",
          kind: "client",
          onError: () => {},
        });
        browser.connect(up, {
          principal: { kind: "server" },
          onProtocolMismatch: both.onProtocolMismatch,
        });
        yield* tick;
        up.close("bye");
        yield* tick;
        assert.deepEqual(both.seen, []);
      }),
    ));
});

const largeArgsResultsAndSnapshotsCross = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  server.route("session:", {
    principal: (name) => ({ host: name }),
    authorize: () => true,
    resolve: (name) =>
      Effect.runPromiseWith(services)(
        Effect.sync(() => {
          const [down, up] = memoryLinkPair();
          const worker = createHost({
            self: { kind: "host" },
            name,
            upstream: { link: up, principal: { kind: "server" } },
            onError: () => {},
          });
          worker.serve(Big, (_input, _principal, self) => {
            const notesState = self.state("notes", Type.Array(Type.String()), large("a"));
            return { variant: "main", notes: notesState, echo: (notes: string[]) => notes };
          });
          return down;
        }),
      ),
  });
  const [down, up] = memoryLinkPair();
  server.accept(down, { principal: { owner: true } });
  const browser = createHost({
    self: { kind: "host" },
    name: "browser",
    kind: "client",
    upstream: { link: up, principal: { kind: "server" } },
    onError: () => {},
  });
  const big = browser.hold(Big, {});
  assert.deepEqual(yield* Effect.promise(() => big.echo(large("c"))), large("c"));
  big.notes.subscribe(() => {});
  for (let i = 0; i < 100 && big.notes.value === undefined; i++) yield* Effect.sleep(5);
  assert.deepEqual(big.notes.value, large("a"));
});

const onlyPayloadsAboveTheThresholdAre = Effect.gen(function* () {
  const [a, b] = memoryLinkPair();
  const frames: Frame[] = [];
  b.receive((frame) => frames.push(frame));
  a.send({ t: "result", id: 1, value: large("v") });
  a.send({ t: "result", id: 2, value: ["small"] });
  a.send({ t: "state", hold: 3, m: "notes", as: "snap", value: large("s") });
  for (let i = 0; i < 50 && frames.length < 3; i++) yield* tick;
  const [packed, small, snap] = frames;
  assert(packed?.t === "result" && packed.value instanceof Packed);
  assert.deepEqual(unpack(packed.value), large("v"));
  assert(small?.t === "result");
  assert.deepEqual(small.value, ["small"]);
  assert(snap?.t === "state" && snap.value instanceof Packed);
  assert.deepEqual(unpack(snap.value), large("s"));

  const [c, d] = memoryLinkPair();
  const forwarded: Frame[] = [];
  d.receive((frame) => forwarded.push(frame));
  c.send({ ...packed, id: 9 });
  for (let i = 0; i < 50 && forwarded.length < 1; i++) yield* tick;
  const relayed = forwarded[0];
  assert(relayed?.t === "result" && relayed.value instanceof Packed);
  assert.deepEqual(relayed.value.bytes, packed.value.bytes);
});

describe("links: packed payloads", () => {
  it("large args, results and snapshots cross a relay deflated and arrive intact", () =>
    Effect.runPromise(largeArgsResultsAndSnapshotsCross));

  it("only payloads above the threshold are packed; the receiver unpacks them", () =>
    Effect.runPromise(onlyPayloadsAboveTheThresholdAre));
});

const aWriteThatFailsAfterThe = Effect.gen(function* () {
  const sent: unknown[] = [];
  const channel: IpcChannel = {
    connected: true,
    send: (message, callback) => {
      sent.push(message);
      const error = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
      if (callback === undefined)
        throw new Error("an IPC send without a callback cannot report EPIPE");
      process.nextTick(() => callback(error));
      return false;
    },
    on: () => undefined,
    off: () => undefined,
  };
  const link = ipcLink(channel);
  const reasons: string[] = [];
  link.onClose((reason) => reasons.push(reason));
  link.send({ t: "ping", n: 1 });
  yield* tick;
  assert.equal(link.closed, true);
  assert.deepEqual(reasons, ["ipc send failed: EPIPE"]);
  assert.equal(sent.length, 1);
  link.send({ t: "ping", n: 2 });
  assert.equal(sent.length, 1, "a closed link sends nothing more");
});

describe("links: IPC", () => {
  it("a write that fails after the peer process exited (EPIPE) ends the link instead of raising an unhandled error", () =>
    Effect.runPromise(aWriteThatFailsAfterThe));
});
