import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";
import { WebSocketServer } from "ws";

import {
  acceptWebSockets,
  createHost,
  hostNamed,
  inflateMessage,
  isChordError,
  method,
  remote,
  type WebSocketLike,
  webSocketLink,
} from "../src/index.ts";
import { latch } from "./fixtures/timing.ts";

const Board = remote("t.board", {
  version: 1,
  input: Type.Object({}),
  host: hostNamed("server"),
  variants: {
    main: {
      state: { notes: Type.Array(Type.String()) },
      methods: { add: method(Type.String()), who: method(undefined, Type.Unknown()) },
    },
  },
});

const servesABrowserStyleClientOver = Effect.gen(function* () {
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  server.serve(Board, (_input, principal, self) => {
    const notes = self.state("notes", Type.Array(Type.String()), []);
    return {
      variant: "main",
      notes,
      add: (text, ctx) => {
        notes.change(ctx, (draft) => {
          draft.push(text);
        });
      },
      who: () => principal,
    };
  });
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  yield* Effect.callback<void>((resume) => {
    wss.once("listening", () => resume(Effect.void));
  });
  acceptWebSockets(wss as never, server, {
    principal: (request: { readonly url?: string | undefined }) => {
      const token = new URL(request.url ?? "/", "http://x").searchParams.get("token");
      return token === "ok" ? { guest: "web" } : undefined;
    },
  });
  const port = (wss.address() as { port: number }).port;
  const open = (token: string) =>
    createHost({
      self: { kind: "host" },
      name: "browser",
      kind: "client",
      upstream: {
        link: webSocketLink(
          new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`) as unknown as WebSocketLike,
        ),
        principal: { kind: "server" },
      },
      onError: () => {},
    });
  yield* Effect.gen(function* () {
    const browser = open("ok");
    const board = browser.hold(Board, {});
    const seen: unknown[] = [];
    board.notes.subscribe((value) => seen.push(value));
    yield* Effect.promise(() => board.add("hello"));
    assert.deepEqual(yield* Effect.promise(() => board.who()), { guest: "web" });
    for (let i = 0; i < 50 && board.notes.value?.length !== 1; i++) yield* Effect.sleep(5);
    assert.deepEqual(board.notes.value, ["hello"]);
    assert.deepEqual(seen.at(-1), ["hello"]);
    yield* Effect.promise(() => browser.close());

    const impostor = createHost({
      self: { kind: "host" },
      name: "session:S1",
      upstream: {
        link: webSocketLink(
          new WebSocket(`ws://127.0.0.1:${port}/?token=ok`) as unknown as WebSocketLike,
        ),
        principal: { kind: "server" },
      },
      onError: () => {},
    });
    yield* Effect.promise(() =>
      assert.rejects(
        impostor.root((ctx) => impostor.hold(Board, {}).add("x", ctx), {
          signal: AbortSignal.timeout(150),
        }),
        (error) => isChordError(error, "aborted"),
      ),
    );
    yield* Effect.promise(() => impostor.close());

    const refused = open("bad");
    const denied = refused.hold(Board, {});
    yield* Effect.promise(() =>
      assert.rejects(
        refused.root((ctx) => denied.add("x", ctx), { signal: AbortSignal.timeout(100) }),
        (error) => isChordError(error, "aborted"),
      ),
    );
    yield* Effect.promise(() => refused.close());
  }).pipe(
    Effect.ensuring(
      Effect.callback<void>((resume) => {
        wss.close(() => resume(Effect.void));
      }),
    ),
  );
});

describe("WebSocket links", () => {
  it("serves a browser-style client over a real socket, stamped by the authenticator", () =>
    Effect.runPromise(servesABrowserStyleClientOver));
});

const largeSnapshotsAndResultsReachThe = Effect.gen(function* () {
  const notes = Array.from({ length: 40 }, (_, i) => `${i}:${"x".repeat(4000)}`);
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  server.serve(Board, (_input, _principal, self) => {
    const state = self.state("notes", Type.Array(Type.String()), notes);
    return { variant: "main", notes: state, add: () => {}, who: () => notes };
  });
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  yield* Effect.callback<void>((resume) => {
    wss.once("listening", () => resume(Effect.void));
  });
  acceptWebSockets(wss as never, server, { principal: () => ({ guest: "web" }) });
  const url = `ws://127.0.0.1:${(wss.address() as { port: number }).port}/`;
  yield* Effect.gen(function* () {
    const binary: Uint8Array[] = [];
    const socket = new WebSocket(url);
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") binary.push(new Uint8Array(event.data as ArrayBuffer));
    });
    const browser = createHost({
      self: { kind: "host" },
      name: "browser",
      kind: "client",
      upstream: {
        link: webSocketLink(socket as unknown as WebSocketLike),
        principal: { kind: "server" },
      },
      onError: () => {},
    });
    const board = browser.hold(Board, {});
    assert.deepEqual(yield* Effect.promise(() => board.who()), notes);
    board.notes.subscribe(() => {});
    for (let i = 0; i < 100 && board.notes.value === undefined; i++) yield* Effect.sleep(5);
    assert.deepEqual(board.notes.value, notes);
    assert(binary.length >= 2, "the result and the snapshot came as binary messages");
    const frames = binary.map(
      (message) => JSON.parse(inflateMessage(message)) as Record<string, unknown>,
    );
    assert(
      frames.some(
        (frame) =>
          frame["t"] === "result" && JSON.stringify(frame["value"]) === JSON.stringify(notes),
      ),
    );
    assert(
      frames.some(
        (frame) =>
          frame["t"] === "state" && JSON.stringify(frame["value"]) === JSON.stringify(notes),
      ),
    );
    yield* Effect.promise(() => browser.close());

    const raw = new WebSocket(url);
    raw.binaryType = "arraybuffer";
    yield* Effect.callback<void>((resume) => {
      raw.addEventListener("open", () => resume(Effect.void));
    });
    const closed = latch();
    raw.addEventListener("close", () => closed.open());
    raw.send(new Uint8Array([0, 0, 0, 2, 123, 125]));
    yield* closed.wait;
  }).pipe(
    Effect.ensuring(
      Effect.callback<void>((resume) => {
        wss.close(() => resume(Effect.void));
      }),
    ),
  );
});

describe("WebSocket links: packed payloads", () => {
  it("large snapshots and results reach the client as binary messages; clients may not send them", () =>
    Effect.runPromise(largeSnapshotsAndResultsReachThe));
});
