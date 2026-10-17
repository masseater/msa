import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import {
  createHost,
  type Frame,
  hostNamed,
  memoryLinkPair,
  method,
  PROTOCOL_VERSION,
  remote,
} from "../src/index.ts";
import { Counter, serveCounter } from "./fixtures/link.ts";
import { tick } from "./fixtures/timing.ts";

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

const mismatches = () => {
  const seen: { local: number; peer: number | undefined }[] = [];
  return {
    seen,
    onProtocolMismatch: (versions: { local: number; peer: number | undefined }) =>
      seen.push(versions),
  };
};

const aPeerWithoutAProtocolVersion = Effect.gen(function* () {
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
  assert(!frames.some((frame) => frame.t === "shape"), "the old client's hold was not served");
});

const aClientLearnsThatItsServer = Effect.gen(function* () {
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
});

const peersOfTheSameVersionTalk = Effect.gen(function* () {
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
});

describe("links: protocol version", () => {
  it("a peer without a protocol version (an old client) is told and dropped; nothing it sends is served", () =>
    Effect.runPromise(aPeerWithoutAProtocolVersion));

  it("a client learns that its server speaks another version, and stops", () =>
    Effect.runPromise(aClientLearnsThatItsServer));

  it("peers of the same version talk; an ordinary close is no mismatch", () =>
    Effect.runPromise(peersOfTheSameVersionTalk));
});
