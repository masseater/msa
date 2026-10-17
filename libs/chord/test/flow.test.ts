import assert from "node:assert/strict";

import { Effect } from "effect";
import { describe, it } from "vite-plus/test";

import {
  createHost,
  type Frame,
  type Link,
  memoryLinkPair,
  PROTOCOL_VERSION,
} from "../src/index.ts";
import {
  client,
  Counter,
  serveCounter,
  stateFrames,
  until,
  WorkerCounter,
} from "./fixtures/flow.ts";

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
