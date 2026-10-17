import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import {
  type Ctx,
  createHost,
  type Frame,
  type Host,
  hostNamed,
  isChordError,
  type Link,
  memoryLinkPair,
  method,
  PROTOCOL_VERSION,
  remote,
} from "../src/index.ts";
import { pollUntil } from "./fixtures/timing.ts";

const until = (check: () => boolean, attempts = 200) => pollUntil(check, attempts, Effect.sleep(2));

class AckGate implements Link {
  readonly inner: Link;
  readonly received: Frame[] = [];
  paused = false;
  #held: Frame | undefined;
  constructor(inner: Link) {
    this.inner = inner;
  }
  get closed(): boolean {
    return this.inner.closed;
  }
  send(frame: Frame): number | undefined {
    if (frame.t === "ack" && this.paused) {
      this.#held = frame;
      return 0;
    }
    return this.inner.send(frame);
  }
  release(): void {
    this.paused = false;
    if (this.#held !== undefined) this.inner.send(this.#held);
    this.#held = undefined;
  }
  receive(handler: (frame: Frame) => void): void {
    this.inner.receive((frame) => {
      this.received.push(frame);
      handler(frame);
    });
  }
  onClose(handler: (reason: string) => void): void {
    this.inner.onClose(handler);
  }
  close(reason?: string): void {
    this.inner.close(reason);
  }
}

const counterOn = (name: string, host: string) =>
  remote(name, {
    version: 1,
    input: Type.Object({}),
    host: hostNamed(host),
    variants: {
      main: {
        state: { count: Type.Object({ n: Type.Number() }) },
        methods: { add: method(Type.Number(), Type.Number()), wait: method() },
      },
    },
  });
const Counter = counterOn("t.flow-counter", "server");
const WorkerCounter = counterOn("t.flow-worker-counter", "w");

let release = () => {};
const waiting = () =>
  new Promise<void>((resolve) => {
    const previous = release;
    release = () => {
      previous();
      resolve();
    };
  });

function serveCounter(host: Host, type = Counter): void {
  host.serve(type, (_input, _principal, self) => {
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
      wait: waiting,
    };
  });
}

function client(server: Host, window: number) {
  const [down, up] = memoryLinkPair();
  server.accept(down, { principal: { user: "u" }, window });
  const gate = new AckGate(up);
  const host = createHost({
    self: { kind: "host" },
    name: "browser",
    kind: "client",
    upstream: { link: gate, principal: { kind: "server" } },
    onError: () => {},
  });
  return { host, gate };
}

const stateFrames = (frames: readonly Frame[]) =>
  frames.filter((frame): frame is Extract<Frame, { t: "state" }> => frame.t === "state");

const holdsStateBackWhileTheWindow = Effect.gen(function* () {
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  serveCounter(server);
  const { host, gate } = client(server, 200);
  const counter = host.hold(Counter, {});
  const values: unknown[] = [];
  counter.count.subscribe((value) => values.push(value));
  yield* until(() => values.at(-1) !== undefined);

  gate.paused = true;
  const results: number[] = [];
  for (let i = 0; i < 40; i++)
    results.push((yield* Effect.promise(() => counter.add(1))) as number);
  assert.equal(results.at(-1), 40);
  assert.ok((values.at(-1) as { n: number }).n < 40, "state waits behind the window");
  const before = stateFrames(gate.received).length;

  gate.release();
  yield* until(() => (values.at(-1) as { n: number }).n === 40);
  assert.equal(
    stateFrames(gate.received).length - before,
    1,
    "the waiting ops arrive as one frame",
  );
  yield* Effect.promise(() => host.close());
  yield* Effect.promise(() => server.close());
});

const replacesOpsThatOutgrowTheirSlot = Effect.gen(function* () {
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  serveCounter(server);
  const { host, gate } = client(server, 64);
  const counter = host.hold(Counter, {});
  const values: unknown[] = [];
  counter.count.subscribe((value) => values.push(value));
  yield* until(() => values.at(-1) !== undefined);

  gate.paused = true;
  const before = gate.received.length;
  for (let i = 0; i < 100; i++) yield* Effect.promise(() => counter.add(1));
  gate.release();
  yield* until(() => (values.at(-1) as { n: number }).n === 100);
  const sent = stateFrames(gate.received.slice(before));
  assert.ok(
    sent.some((frame) => frame.as === "reset"),
    "a reset replaced the ops",
  );
  assert.ok(sent.length < 10, `few state frames, not one per change (${sent.length})`);
  yield* Effect.promise(() => host.close());
  yield* Effect.promise(() => server.close());
});

const dropsWhatWaitsForAReference = Effect.gen(function* () {
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  serveCounter(server);
  const { host, gate } = client(server, 64);
  const counter = host.hold(Counter, {});
  yield* Effect.promise(() => counter.ready);
  const other = host.hold(Counter, {});
  yield* Effect.promise(() => other.ready);

  gate.paused = true;
  for (let i = 0; i < 10; i++) yield* Effect.promise(() => counter.add(1));
  counter.release();
  other.release();
  const before = gate.received.length;
  gate.release();
  yield* Effect.sleep(10);
  assert.deepEqual(stateFrames(gate.received.slice(before)), []);
  yield* Effect.promise(() => host.close());
  yield* Effect.promise(() => server.close());
});

const coalescesRelayedStateForTheOrigin = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  const toWorker: Frame[] = [];
  server.route("w", {
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
          serveCounter(worker, WorkerCounter);
          return {
            get closed() {
              return down.closed;
            },
            send: (frame: Frame) => {
              toWorker.push(frame);
              return down.send(frame);
            },
            receive: (handler) => down.receive(handler),
            onClose: (handler) => down.onClose(handler),
            close: (reason) => down.close(reason),
          } satisfies Link;
        }),
      ),
  });
  const { host, gate } = client(server, 64);
  const counter = host.hold(WorkerCounter, {});
  const values: unknown[] = [];
  counter.count.subscribe((value) => values.push(value));
  yield* until(() => values.at(-1) !== undefined);
  const resyncs = () => toWorker.filter((frame) => frame.t === "resync").length;
  assert.equal(resyncs(), 0);

  gate.paused = true;
  for (let i = 0; i < 100; i++) yield* Effect.promise(() => counter.add(1));
  assert.ok(resyncs() >= 1, "the overflowing stream was resynced downstream");
  assert.ok(!toWorker.some((frame) => frame.t === "sub" || frame.t === "unsub"));
  gate.release();
  yield* until(() => (values.at(-1) as { n: number }).n === 100);
  yield* Effect.promise(() => host.close());
  yield* Effect.promise(() => server.close());
});

const neitherWindowsNorAcknowledgesAPeer = Effect.gen(function* () {
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  serveCounter(server);
  const [down, raw] = memoryLinkPair();
  server.accept(down, { principal: { user: "u" }, window: 1 });
  const frames: Frame[] = [];
  raw.receive((frame) => frames.push(frame));
  raw.send({
    t: "hello",
    protocol: PROTOCOL_VERSION,
    name: "raw",
    kind: "client",
    codeVersion: 0,
  });
  raw.send({ t: "hold", id: 1, at: "server", token: Counter.description, input: {} });
  for (let i = 0; i < 5; i++) raw.send({ t: "call", id: 3 + i, hold: 1, member: "add", args: 1 });
  yield* until(() => frames.filter((frame) => frame.t === "result").length === 5);
  yield* Effect.sleep(5);
  assert.equal(stateFrames(frames).length, 6, "the snapshot and one frame per change");
  assert.ok(!frames.some((frame) => frame.t === "ack"));
  assert.equal((frames[0] as Extract<Frame, { t: "hello" }>).acks, true);
  yield* Effect.promise(() => server.close());
});

const closesTheLinkOnAnAcknowledgement = Effect.gen(function* () {
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  const [down, raw] = memoryLinkPair();
  server.accept(down, { principal: { user: "u" } });
  raw.receive(() => {});
  raw.send({ t: "hello", name: "raw", kind: "client", codeVersion: 0, acks: true });
  raw.send({ t: "ack", n: 99 });
  yield* until(() => raw.closed);
  yield* Effect.promise(() => server.close());
});

describe("link flow control", () => {
  it("holds state back while the window is full, answers calls meanwhile, and sends one coalesced frame", () =>
    Effect.runPromise(holdsStateBackWhileTheWindow));

  it("replaces ops that outgrow their slot with the current value", () =>
    Effect.runPromise(replacesOpsThatOutgrowTheirSlot));

  it("drops what waits for a reference that is released", () =>
    Effect.runPromise(dropsWhatWaitsForAReference));

  it("coalesces relayed state for the origin and asks downstream for a reset when it overflows", () =>
    Effect.runPromise(coalescesRelayedStateForTheOrigin));

  it("neither windows nor acknowledges a peer whose hello does not announce acks", () =>
    Effect.runPromise(neitherWindowsNorAcknowledgesAPeer));

  it("closes the link on an acknowledgement of frames never sent", () =>
    Effect.runPromise(closesTheLinkOnAnAcknowledgement));
});

const answersCallsBeyondMaxcallsAtOnce = Effect.gen(function* () {
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  serveCounter(server);
  const [down, up] = memoryLinkPair();
  server.accept(down, { principal: { user: "u" }, maxCalls: 2 });
  const host = createHost({
    self: { kind: "host" },
    name: "browser",
    kind: "client",
    upstream: { link: up, principal: { kind: "server" } },
    onError: () => {},
  });
  const counter = host.hold(Counter, {});
  yield* Effect.promise(() => counter.ready);
  release = () => {};
  const first = counter.wait();
  const second = counter.wait();
  yield* Effect.promise(() =>
    assert.rejects(
      counter.add(1),
      (error) => isChordError(error, "unavailable") && error.reason === "too_many_calls",
    ),
  );
  release();
  yield* Effect.promise(() => Promise.all([first, second]));
  assert.equal(yield* Effect.promise(() => counter.add(1)), 1);
  yield* Effect.promise(() => host.close());
  yield* Effect.promise(() => server.close());
});

describe("link call limit", () => {
  it("answers calls beyond maxCalls at once with too_many_calls and keeps the link", () =>
    Effect.runPromise(answersCallsBeyondMaxcallsAtOnce));
});
