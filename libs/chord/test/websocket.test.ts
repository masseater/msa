import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";
import { WebSocketServer } from "ws";

import chord from "../src/index.ts";
import type chordTypes from "../src/index.types.ts";
import timing from "./fixtures/timing.ts";

const {
  acceptWebSockets,
  createHost,
  hostNamed,
  inflateMessage,
  isChordError,
  method,
  remote,
  webSocketLink,
} = chord;

const { latch } = timing;

const Board = remote("t.board", {
  host: hostNamed("server"),
  input: Type.Object({}),
  variants: {
    main: {
      methods: { add: method(Type.String()), who: method(undefined, Type.Unknown()) },
      state: { notes: Type.Array(Type.String()) },
    },
  },
  version: 1,
});

type Principal = (request: { readonly url?: string | undefined }) => unknown;

const withSocketServer = <A>(
  server: chordTypes.Host,
  principal: Principal,
  use: (port: number) => Effect.Effect<A>,
): Effect.Effect<A> =>
  Effect.gen(function* () {
    const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    yield* Effect.callback<void>((resume) => {
      wss.once("listening", () => resume(Effect.void));
    });
    acceptWebSockets(wss as never, server, { principal });
    return yield* use((wss.address() as { port: number }).port).pipe(
      Effect.ensuring(
        Effect.callback<void>((resume) => {
          wss.close(() => resume(Effect.void));
        }),
      ),
    );
  });

const socketHost = (name: string, socket: WebSocket, client = true): chordTypes.Host =>
  createHost({
    name,
    onError: () => {},
    self: { kind: "host" },
    upstream: {
      link: webSocketLink(socket as unknown as chordTypes.WebSocketLike),
      principal: { kind: "server" },
    },
    ...(client ? { kind: "client" as const } : {}),
  });

const serveBoard = (server: chordTypes.Host): void => {
  server.serve(Board, (_input, principal, self) => {
    const notes = self.state("notes", Type.Array(Type.String()), []);
    return {
      add: (text, ctx) => {
        notes.change(ctx, (draft) => {
          draft.push(text);
        });
      },
      notes,
      variant: "main",
      who: () => principal,
    };
  });
};

const byToken: Principal = (request) => {
  const token = new URL(request.url ?? "/", "http://x").searchParams.get("token");
  return token === "ok" ? { guest: "web" } : undefined;
};

const stampsAcceptedBrowser = (port: number) =>
  Effect.gen(function* () {
    const browser = socketHost("browser", new WebSocket(`ws://127.0.0.1:${port}/?token=ok`));
    const board = browser.hold(Board, {});
    const seen: unknown[] = [];
    board.notes.subscribe((value) => seen.push(value));
    yield* Effect.promise(() => board.add("hello"));
    assert.deepEqual(yield* Effect.promise(() => board.who()), { guest: "web" });
    for (let i = 0; i < 50 && board.notes.value?.length !== 1; i++) yield* Effect.sleep(5);
    assert.deepEqual(board.notes.value, ["hello"]);
    assert.deepEqual(seen.at(-1), ["hello"]);
    yield* Effect.promise(() => browser.close());
  });

const refusesImpostorAndBadToken = (port: number) =>
  Effect.gen(function* () {
    const impostor = socketHost(
      "session:S1",
      new WebSocket(`ws://127.0.0.1:${port}/?token=ok`),
      false,
    );
    yield* Effect.promise(() =>
      assert.rejects(
        impostor.root((ctx) => impostor.hold(Board, {}).add("x", ctx), {
          signal: AbortSignal.timeout(150),
        }),
        (error) => isChordError(error, "aborted"),
      ),
    );
    yield* Effect.promise(() => impostor.close());

    const refused = socketHost("browser", new WebSocket(`ws://127.0.0.1:${port}/?token=bad`));
    const denied = refused.hold(Board, {});
    yield* Effect.promise(() =>
      assert.rejects(
        refused.root((ctx) => denied.add("x", ctx), { signal: AbortSignal.timeout(100) }),
        (error) => isChordError(error, "aborted"),
      ),
    );
    yield* Effect.promise(() => refused.close());
  });

const servesABrowserStyleClientOver = Effect.gen(function* () {
  const server = createHost({ name: "server", onError: () => {}, self: { kind: "host" } });
  serveBoard(server);
  yield* withSocketServer(server, byToken, (port) =>
    Effect.andThen(stampsAcceptedBrowser(port), refusesImpostorAndBadToken(port)),
  );
});

describe("WebSocket links", () => {
  it("serves a browser-style client over a real socket, stamped by the authenticator", () =>
    Effect.runPromise(servesABrowserStyleClientOver));
});

const matchesNotes = (frames: readonly Record<string, unknown>[], t: string, notes: string[]) =>
  frames.some(
    (frame) => frame["t"] === t && JSON.stringify(frame["value"]) === JSON.stringify(notes),
  );

const deliversPackedPayloads = (url: string, notes: string[]) =>
  Effect.gen(function* () {
    const binary: Uint8Array[] = [];
    const socket = new WebSocket(url);
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") binary.push(new Uint8Array(event.data as ArrayBuffer));
    });
    const browser = socketHost("browser", socket);
    const board = browser.hold(Board, {});
    assert.deepEqual(yield* Effect.promise(() => board.who()), notes);
    board.notes.subscribe(() => {});
    for (let i = 0; i < 100 && board.notes.value === undefined; i++) yield* Effect.sleep(5);
    assert.deepEqual(board.notes.value, notes);
    assert(binary.length >= 2, "the result and the snapshot came as binary messages");
    const frames = binary.map(
      (message) => JSON.parse(inflateMessage(message)) as Record<string, unknown>,
    );
    assert(matchesNotes(frames, "result", notes));
    assert(matchesNotes(frames, "state", notes));
    yield* Effect.promise(() => browser.close());
  });

const closesOnPackedClientMessage = (url: string) =>
  Effect.gen(function* () {
    const raw = new WebSocket(url);
    raw.binaryType = "arraybuffer";
    yield* Effect.callback<void>((resume) => {
      raw.addEventListener("open", () => resume(Effect.void));
    });
    const closed = latch();
    raw.addEventListener("close", () => closed.open());
    raw.send(new Uint8Array([0, 0, 0, 2, 123, 125]));
    yield* closed.wait;
  });

const largeSnapshotsAndResultsReachThe = Effect.gen(function* () {
  const notes = Array.from({ length: 40 }, (_, i) => `${i}:${"x".repeat(4000)}`);
  const server = createHost({ name: "server", onError: () => {}, self: { kind: "host" } });
  server.serve(Board, (_input, _principal, self) => {
    const state = self.state("notes", Type.Array(Type.String()), notes);
    return { add: () => {}, notes: state, variant: "main", who: () => notes };
  });
  yield* withSocketServer(
    server,
    () => ({ guest: "web" }),
    (port) => {
      const url = `ws://127.0.0.1:${port}/`;
      return Effect.andThen(deliversPackedPayloads(url, notes), closesOnPackedClientMessage(url));
    },
  );
});

describe("WebSocket links: packed payloads", () => {
  it("large snapshots and results reach the client as binary messages; clients may not send them", () =>
    Effect.runPromise(largeSnapshotsAndResultsReachThe));
});
