import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import {
  type Frame,
  PROTOCOL_VERSION,
  createHost,
  hostNamed,
  memoryLinkPair,
  method,
  remote,
} from "../src/index.ts";
import linkModule from "./fixtures/link.ts";
import timing from "./fixtures/timing.ts";

const { Counter, serveCounter } = linkModule;
const { tick } = timing;

const Tool = remote("t.tool", {
  host: hostNamed("server"),
  input: Type.Object({}),
  variants: {
    main: {
      methods: {
        count: method(undefined, Type.Number()),
        note: method(Type.String()),
        ping: method(),
      },
    },
  },
  version: 1,
});

const travelWithoutArgsAndWithoutA = Effect.gen(function* () {
  const server = createHost({ name: "server", onError: () => {}, self: { kind: "host" } });
  const notes: string[] = [];
  server.serve(Tool, () => ({
    count: () => 2,
    note: (text) => {
      notes.push(text);
      return "dropped" as never;
    },
    ping: () => {},
    variant: "main",
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
    kind: "client",
    name: "browser",
    onError: () => {},
    self: { kind: "host" },
    upstream: { link: up, principal: { kind: "server" } },
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
    onProtocolMismatch: (versions: { local: number; peer: number | undefined }) =>
      seen.push(versions),
    seen,
  };
};

const aPeerWithoutAProtocolVersion = Effect.gen(function* () {
  const server = createHost({ name: "server", onError: () => {}, self: { kind: "host" } });
  serveCounter(server);
  const accepted = mismatches();
  const [down, raw] = memoryLinkPair();
  server.accept(down, {
    onProtocolMismatch: accepted.onProtocolMismatch,
    principal: { guest: "g" },
  });
  const frames: Frame[] = [];
  let closed: string | undefined;
  raw.receive((frame) => frames.push(frame));
  raw.onClose((reason) => {
    closed = reason;
  });
  raw.send({ codeVersion: 0, kind: "client", name: "old", t: "hello" });
  raw.send({
    at: "server",
    id: 1,
    input: { name: "c" },
    t: "hold",
    token: Counter.description,
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
    kind: "client",
    name: "browser",
    onError: () => {},
    self: { kind: "host" },
  });
  browser.connect(up, {
    onProtocolMismatch: client.onProtocolMismatch,
    principal: { kind: "server" },
  });
  down.send({
    codeVersion: 1,
    kind: "host",
    name: "server",
    protocol: PROTOCOL_VERSION + 1,
    t: "hello",
  });
  yield* tick;
  assert.deepEqual(client.seen, [{ local: PROTOCOL_VERSION, peer: PROTOCOL_VERSION + 1 }]);
  assert.equal(up.closed, true);

  const told = mismatches();
  const [down2, up2] = memoryLinkPair();
  const other = createHost({
    kind: "client",
    name: "browser",
    onError: () => {},
    self: { kind: "host" },
  });
  other.connect(up2, {
    onProtocolMismatch: told.onProtocolMismatch,
    principal: { kind: "server" },
  });
  down2.close(`protocol-version ${PROTOCOL_VERSION + 1}`);
  yield* tick;
  assert.deepEqual(told.seen, [{ local: PROTOCOL_VERSION, peer: PROTOCOL_VERSION + 1 }]);
});

const peersOfTheSameVersionTalk = Effect.gen(function* () {
  const both = mismatches();
  const server = createHost({ name: "server", onError: () => {}, self: { kind: "host" } });
  const [down, up] = memoryLinkPair();
  server.accept(down, {
    onProtocolMismatch: both.onProtocolMismatch,
    principal: { guest: "g" },
  });
  const browser = createHost({
    kind: "client",
    name: "browser",
    onError: () => {},
    self: { kind: "host" },
  });
  browser.connect(up, {
    onProtocolMismatch: both.onProtocolMismatch,
    principal: { kind: "server" },
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
