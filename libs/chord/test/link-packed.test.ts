import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import chord from "../src/index.ts";
import type chordTypes from "../src/index.types.ts";
import linkModule2 from "../src/link.ts";
import chordNode from "../src/node.ts";
import linkModule from "./fixtures/link.ts";
import timing from "./fixtures/timing.ts";

const { createHost, ipcLink, memoryLinkPair } = chord;
const { Packed, unpack } = linkModule2;
const { zlibCompression } = chordNode;
const zlibLinks = { compression: zlibCompression };

const { Big, large } = linkModule;
const { pollUntil, tick } = timing;

const largeArgsResultsAndSnapshotsCross = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const server = createHost({ name: "server", onError: () => {}, self: { kind: "host" } });
  server.route("session:", {
    authorize: () => true,
    principal: (name) => ({ host: name }),
    resolve: (name) =>
      Effect.runPromiseWith(services)(
        Effect.sync(() => {
          const [down, up] = memoryLinkPair(zlibLinks);
          const worker = createHost({
            name,
            onError: () => {},
            self: { kind: "host" },
            upstream: { link: up, principal: { kind: "server" } },
          });
          worker.serve(Big, (_input, _principal, self) => {
            const notesState = self.state("notes", Type.Array(Type.String()), large("a"));
            return { echo: (notes: string[]) => notes, notes: notesState, variant: "main" };
          });
          return down;
        }),
      ),
  });
  const [down, up] = memoryLinkPair(zlibLinks);
  server.accept(down, { principal: { owner: true } });
  const browser = createHost({
    kind: "client",
    name: "browser",
    onError: () => {},
    self: { kind: "host" },
    upstream: { link: up, principal: { kind: "server" } },
  });
  const big = browser.hold(Big, {});
  assert.deepEqual(yield* Effect.promise(() => big.echo(large("c"))), large("c"));
  big.notes.subscribe(() => {});
  yield* pollUntil(() => big.notes.value !== undefined, 100, Effect.sleep(5));
  assert.deepEqual(big.notes.value, large("a"));
});

const onlyPayloadsAboveTheThresholdAre = Effect.gen(function* () {
  const [a, b] = memoryLinkPair(zlibLinks);
  const frames: chordTypes.Frame[] = [];
  b.receive((frame) => frames.push(frame));
  a.send({ id: 1, t: "result", value: large("v") });
  a.send({ id: 2, t: "result", value: ["small"] });
  a.send({ as: "snap", hold: 3, m: "notes", t: "state", value: large("s") });
  yield* pollUntil(() => frames.length >= 3, 50, tick);
  const [packed, small, snap] = frames;
  assert(packed?.t === "result" && packed.value instanceof Packed);
  assert.deepEqual(unpack(packed.value), large("v"));
  assert(small?.t === "result");
  assert.deepEqual(small.value, ["small"]);
  assert(snap?.t === "state" && snap.value instanceof Packed);
  assert.deepEqual(unpack(snap.value), large("s"));

  const [c, d] = memoryLinkPair(zlibLinks);
  const forwarded: chordTypes.Frame[] = [];
  d.receive((frame) => forwarded.push(frame));
  c.send({ ...packed, id: 9 });
  yield* pollUntil(() => forwarded.length >= 1, 50, tick);
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
  const channel: chordTypes.IpcChannel = {
    connected: true,
    off: () => undefined,
    on: () => undefined,
    send: (message, callback) => {
      sent.push(message);
      const error = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
      if (callback === undefined)
        throw new Error("an IPC send without a callback cannot report EPIPE");
      process.nextTick(() => callback(error));
      return false;
    },
  };
  const link = ipcLink(channel);
  const reasons: string[] = [];
  link.onClose((reason) => reasons.push(reason));
  link.send({ n: 1, t: "ping" });
  yield* tick;
  assert.equal(link.closed, true);
  assert.deepEqual(reasons, ["ipc send failed: EPIPE"]);
  assert.equal(sent.length, 1);
  link.send({ n: 2, t: "ping" });
  assert.equal(sent.length, 1, "a closed link sends nothing more");
});

describe("links: IPC", () => {
  it("a write that fails after the peer process exited (EPIPE) ends the link instead of raising an unhandled error", () =>
    Effect.runPromise(aWriteThatFailsAfterThe));
});
