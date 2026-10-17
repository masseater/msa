import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import { createHost, type Frame, type IpcChannel, ipcLink, memoryLinkPair } from "../src/index.ts";
import { Packed, unpack } from "../src/link.ts";
import { Big, large } from "./fixtures/link.ts";
import { tick } from "./fixtures/timing.ts";

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
