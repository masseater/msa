import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expectTypeOf, it } from "vite-plus/test";

import { HostImpl } from "../src/host.ts";
import {
  type Ctx,
  createHost,
  type Frame,
  type Host,
  hostFamily,
  hostNamed,
  isChordError,
  type Link,
  local,
  memoryLinkPair,
  method,
  PROTOCOL_VERSION,
  remote,
} from "../src/index.ts";
import { CountingLink, stateFrames } from "./fixtures/counting.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function until(check: () => boolean, attempts = 200): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      for (let i = 0; i < attempts && !check(); i++) yield* Effect.promise(() => sleep(2));
      assert.ok(check(), "condition not reached");
    }),
  );
}

const NoteSchema = Type.Array(Type.String());
const Notes = remote("t.e8-notes", {
  version: 1,
  input: Type.Object({ list: Type.Optional(Type.String({ default: "main" })) }),
  host: hostNamed("server"),
  variants: {
    main: {
      state: { notes: NoteSchema, title: Type.String() },
      methods: { add: method(Type.String()), rename: method(Type.String()) },
    },
  },
});

function serveNotes(host: Host): void {
  host.serve(Notes, (_input, _principal, self) => {
    const notes = self.state("notes", NoteSchema, []);
    const title = self.state("title", Type.String(), "untitled");
    return {
      variant: "main",
      notes,
      title,
      add: (text: string, ctx: Ctx) => {
        notes.change(ctx, (draft) => {
          draft.push(text);
        });
      },
      rename: (text: string, ctx: Ctx) => {
        title.replace(ctx, text);
      },
    };
  });
}

function setup(
  options: {
    readonly window?: number;
    readonly linger?: { types?: Record<string, number>; cap?: number };
  } = {},
) {
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  serveNotes(server);
  const [down, up] = memoryLinkPair();
  server.accept(down, {
    principal: { user: "u" },
    ...(options.window === undefined ? {} : { window: options.window }),
  });
  const link = new CountingLink(up);
  const errors: unknown[] = [];
  const browser = createHost({
    self: { kind: "host" },
    name: "browser",
    kind: "client",
    upstream: { link, principal: { kind: "server" } },
    onError: (error) => errors.push(error),
    ...(options.linger === undefined ? {} : { linger: options.linger }),
  });
  return { server, browser, link, errors };
}

describe("shared bindings: traffic", () => {
  it("N references to one object: one hold, one snapshot per member, one frame per change, one release", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const services = yield* Effect.context<never>();
        const { server, browser, link } = setup();
        const Panel = local("t.e8-panel", {
          version: 1,
          input: Type.Object({}),
          members: { count: Type.Number() },
        });
        browser.serve(Panel, (_input, _principal, self) => {
          const notes = self.get(Notes, {});
          return { count: self.derive([notes.notes], (list) => list.length) };
        });
        const a = browser.hold(Notes, {});
        const b = browser.hold(Notes, { list: "main" });
        const panel = browser.hold(Panel, {});
        yield* Effect.promise(() => Promise.all([a.ready, b.ready, panel.ready]));
        const viaCtx = yield* Effect.promise(() =>
          browser.root((ctx) =>
            Effect.runPromiseWith(services)(
              Effect.gen(function* () {
                const ref = yield* Effect.promise(() => ctx.get(Notes, {}));
                return ref.title.value;
              }),
            ),
          ),
        );
        assert.equal(viaCtx, "untitled");
        assert.equal(link.count("sent", "hold"), 1, "one hold for every reference");
        const snaps = stateFrames(link.received).filter((frame) => frame.as === "snap");
        assert.deepEqual(snaps.map((frame) => frame.m).sort(), ["notes", "title"]);

        const before = stateFrames(link.received).length;
        yield* Effect.promise(() => a.add("milk"));
        yield* Effect.promise(() =>
          until(
            () =>
              a.notes.value.length === 1 && b.notes.value.length === 1 && panel.count.value === 1,
          ),
        );
        yield* Effect.promise(() => tick());
        assert.equal(
          stateFrames(link.received).length - before,
          1,
          "one delta frame for one change, whatever N",
        );

        const sent = link.traffic("sent").length;
        a.release();
        panel.release();
        yield* Effect.promise(() => sleep(5));
        assert.equal(
          link.traffic("sent").length,
          sent,
          "releasing all but one reference sends nothing",
        );
        b.release();
        yield* Effect.promise(() => until(() => link.count("sent", "release") === 1));
        yield* Effect.promise(() => browser.close());
        yield* Effect.promise(() => server.close());
      }),
    ));

  it("a held reference stays subscribed without listeners; values are readable at once after ready", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { server, browser } = setup();
        const notes = browser.hold(Notes, {});
        yield* Effect.promise(() => notes.ready);
        assert.deepEqual(notes.notes.value, []);
        yield* Effect.promise(() => notes.add("bread"));
        yield* Effect.promise(() => until(() => notes.notes.value.length === 1));
        assert.equal(notes.title.value, "untitled");
        yield* Effect.promise(() => browser.close());
        yield* Effect.promise(() => server.close());
      }),
    ));
});

describe("shared bindings: linger", () => {
  it("a lingering binding keeps its hold and state; a reference taken meanwhile costs nothing on the link", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { server, browser, link } = setup({ linger: { types: { [Notes.name]: 40 } } });
        const first = yield* Effect.promise(() => browser.get(Notes, {}));
        const frames = link.traffic("received").length;
        first.release();
        yield* Effect.promise(() => sleep(10));
        assert.equal(link.count("sent", "release"), 0, "not released before the linger");
        for (let i = 0; i < 3; i++) {
          const again = yield* Effect.promise(() => browser.get(Notes, {}));
          assert.deepEqual(again.notes.value, []);
          again.release();
        }
        assert.equal(link.count("sent", "hold"), 1);
        assert.equal(link.traffic("received").length, frames, "nothing new crossed the link");
        yield* Effect.promise(() => until(() => link.count("sent", "release") === 1));
        yield* Effect.promise(() => browser.close());
        yield* Effect.promise(() => server.close());
      }),
    ));

  it("at most `cap` bindings linger: the least recently released goes first", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { server, browser, link } = setup({
          linger: { types: { [Notes.name]: 10_000 }, cap: 1 },
        });
        const a = yield* Effect.promise(() => browser.get(Notes, { list: "a" }));
        const b = yield* Effect.promise(() => browser.get(Notes, { list: "b" }));
        a.release();
        yield* Effect.promise(() => sleep(5));
        assert.equal(link.count("sent", "release"), 0);
        b.release();
        yield* Effect.promise(() => until(() => link.count("sent", "release") === 1));
        const release = link.sent.find((frame) => frame.t === "release");
        const holdOfA = link.sent.find(
          (frame) => frame.t === "hold" && (frame.input as { list: string }).list === "a",
        );
        assert.equal(
          release?.t === "release" ? release.id : 0,
          holdOfA?.t === "hold" ? holdOfA.id : -1,
        );
        yield* Effect.promise(() => browser.close());
        yield* Effect.promise(() => server.close());
      }),
    ));
});

describe("shared bindings: identity", () => {
  it("normalized-equal inputs and equal principal keys share; other principals and fingerprints do not", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = createHost({
          self: { kind: "host" },
          name: "server",
          onError: () => {},
        });
        const NotesV2 = remote("t.e8-notes", {
          version: 2,
          input: Type.Object({ list: Type.Optional(Type.String({ default: "main" })) }),
          host: hostNamed("server"),
          variants: {
            main: {
              state: { notes: NoteSchema, title: Type.String() },
              methods: {
                add: method(Type.String()),
                rename: method(Type.String()),
                clear: method(),
              },
            },
          },
        });
        server.serve(
          NotesV2,
          (_input, _principal, self) => {
            const notes = self.state("notes", NoteSchema, []);
            const title = self.state("title", Type.String(), "untitled");
            return {
              variant: "main",
              notes,
              title,
              add: () => {},
              rename: () => {},
              clear: () => {},
            };
          },
          { accepts: { 1: (current) => current } },
        );
        const [down, up] = memoryLinkPair();
        server.accept(down, { principal: { worker: "w" }, kind: "host", name: "session:w" });
        const link = new CountingLink(up);
        const worker = createHost<unknown>({
          self: { kind: "host" },
          name: "session:w",
          upstream: { link, principal: { kind: "server" } },
          onError: () => {},
        });
        const refs = [
          worker.hold(Notes, {}),
          worker.hold(Notes, { list: "main" }),
          worker.hold(Notes, {}, { principal: { user: "a", grant: 1 } }),
          worker.hold(Notes, {}, { principal: { grant: 1, user: "a" } }),
          worker.hold(Notes, {}, { principal: { user: "a", grant: 2 } }),
          worker.hold(NotesV2, {}),
        ];
        yield* Effect.promise(() => Promise.all(refs.map((ref) => ref.ready)));
        assert.equal(link.count("sent", "hold"), 4);
        yield* Effect.promise(() => worker.close());
        yield* Effect.promise(() => server.close());
      }),
    ));
});

describe("hydration over a link", () => {
  const Matrix = remote("t.e8-matrix", {
    version: 1,
    input: Type.Object({ variant: Type.String() }),
    host: hostNamed("server"),
    variants: {
      values: {
        state: { none: Type.Null(), empty: Type.Array(Type.String()), maybe: Type.Unknown() },
      },
      bare: { methods: { ping: method(undefined, Type.String()) } },
      broken: { state: { n: Type.Number() } },
    },
  });

  function serveMatrix(host: Host): void {
    host.serve(Matrix, ({ variant }, _principal, self) => {
      if (variant === "bare") return { variant: "bare", ping: () => "pong" };
      if (variant === "broken") {
        const source = self.state("source", Type.String(), "not a number");
        return { variant: "broken", n: self.derive([source], (text) => text as unknown as number) };
      }
      const none = self.state("none", Type.Null(), null);
      const empty = self.state("empty", Type.Array(Type.String()), []);
      return {
        variant: "values",
        none,
        empty,
        maybe: self.derive([none], () => undefined as unknown),
      };
    });
  }

  it("null, empty and undefined values hydrate; a state-free variant is ready; a failed snapshot rejects", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
        serveMatrix(server);
        const [down, up] = memoryLinkPair();
        server.accept(down, { principal: { user: "u" } });
        const browser = createHost({
          self: { kind: "host" },
          name: "browser",
          kind: "client",
          upstream: { link: up, principal: { kind: "server" } },
          onError: () => {},
        });
        const values = yield* Effect.promise(() => browser.get(Matrix, { variant: "values" }));
        assert.ok(values.variant === "values");
        assert.equal(values.none.value, null);
        assert.deepEqual(values.empty.value, []);
        assert.equal(values.maybe.value, undefined);
        const bare = yield* Effect.promise(() => browser.get(Matrix, { variant: "bare" }));
        assert.ok(bare.variant === "bare");
        assert.equal(yield* Effect.promise(() => bare.ping()), "pong");
        expectTypeOf(bare).not.toHaveProperty("none");
        assert.throws(
          () => Reflect.get(Reflect.get(bare, "none"), "value"),
          (error) => isChordError(error, "not_in_variant"),
        );
        const broken = browser.hold(Matrix, { variant: "broken" });
        yield* Effect.promise(() =>
          assert.rejects(broken.ready, (error) => isChordError(error, "invalid")),
        );
        assert.equal(broken.status, "gone");
        yield* Effect.promise(() => browser.close());
        yield* Effect.promise(() => server.close());
      }),
    ));

  it("reading before the first hydration throws not_ready", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { server, browser } = setup();
        const notes = browser.hold(Notes, {});
        assert.throws(
          () => notes.notes.value,
          (error) => isChordError(error, "not_ready"),
        );
        yield* Effect.promise(() => notes.ready);
        assert.deepEqual(notes.notes.value, []);
        yield* Effect.promise(() => browser.close());
        yield* Effect.promise(() => server.close());
      }),
    ));
});

describe("method-only references (state: false)", () => {
  it("transfer no state alone; a full reference joining starts it once; its release stops it", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { server, browser, link } = setup();
        const caller = browser.hold(Notes, {}, { state: false });
        yield* Effect.promise(() => caller.ready);
        yield* Effect.promise(() => caller.add("x"));
        const hold = link.sent.find((frame) => frame.t === "hold");
        assert.ok(hold?.t === "hold" && hold.state === false);
        assert.deepEqual(stateFrames(link.received), []);
        assert.throws(
          () => caller.notes.value,
          (error) => isChordError(error, "not_ready"),
        );

        const viewer = browser.hold(Notes, {});
        yield* Effect.promise(() => viewer.ready);
        assert.deepEqual(viewer.notes.value, ["x"]);
        assert.equal(link.count("sent", "sub"), 1);
        assert.equal(link.count("sent", "hold"), 1, "the same hold");
        viewer.release();
        yield* Effect.promise(() => until(() => link.count("sent", "unsub") === 1));
        const after = stateFrames(link.received).length;
        yield* Effect.promise(() => caller.add("y"));
        yield* Effect.promise(() => sleep(5));
        assert.equal(
          stateFrames(link.received).length,
          after,
          "no state once only method-only references remain",
        );
        yield* Effect.promise(() => browser.close());
        yield* Effect.promise(() => server.close());
      }),
    ));
});

describe("origins of client holds", () => {
  const Counter = remote("t.e8-counter", {
    version: 1,
    input: Type.Object({ session: Type.String() }),
    host: hostFamily("session:", "session"),
    variants: { main: { state: { n: Type.Number() }, methods: { add: method(Type.Number()) } } },
  });

  function cluster() {
    const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
    let worker: HostImpl | undefined;
    let toWorker: CountingLink | undefined;
    server.route("session:", {
      principal: (name) => ({ host: name }),
      authorize: () => true,
      resolve: (name) =>
        Effect.runPromise(
          Effect.sync(() => {
            if (toWorker !== undefined) return toWorker;
            const [down, up] = memoryLinkPair();
            const created = new HostImpl({
              self: { kind: "host" },
              name,
              upstream: { link: up, principal: { kind: "server" } },
              onError: () => {},
            });
            created.serve(Counter, (_input, _principal, self) => {
              const n = self.state("n", Type.Number(), 0);
              return {
                variant: "main",
                n,
                add: (delta: number, ctx: Ctx) => {
                  n.replace(ctx, n.value + delta);
                },
              };
            });
            worker = created;
            toWorker = new CountingLink(down);
            return toWorker;
          }),
        ),
    });
    const browser = () => {
      const [down, up] = memoryLinkPair();
      server.accept(down, { principal: { guest: "g" } });
      const host = createHost({
        self: { kind: "host" },
        name: "browser",
        kind: "client",
        upstream: { link: up, principal: { kind: "server" } },
        onError: () => {},
      });
      return { host, up };
    };
    const origins = () =>
      [...(worker?.upstream?.served.values() ?? [])].map((served) =>
        served.kind === "local" ? served.origin : undefined,
      );
    return { server, browser, origins, sentToWorker: () => toWorker?.sent ?? [] };
  }

  it("a relayed hold carries its client connection's id; the server's own holds carry none", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const c = cluster();
        const one = c.browser();
        const two = c.browser();
        yield* Effect.promise(() => one.host.hold(Counter, { session: "S1" }).ready);
        yield* Effect.promise(() => two.host.hold(Counter, { session: "S1" }).ready);
        const own = c.server.hold(Counter, { session: "S1" });
        yield* Effect.promise(() => own.ready);
        const holds = c
          .sentToWorker()
          .filter((frame): frame is Extract<Frame, { t: "hold" }> => frame.t === "hold");
        assert.equal(holds.length, 3);
        const relayed = holds.filter((frame) => frame.origin !== undefined);
        assert.equal(relayed.length, 2);
        assert.notEqual(relayed[0]!.origin, relayed[1]!.origin, "two tabs, two origins");
        assert.equal(holds.filter((frame) => frame.origin === undefined).length, 1);

        const before = new Set(c.origins());
        one.up.close();
        yield* Effect.promise(() =>
          until(() => c.origins().filter((origin) => origin !== undefined).length === 1),
        );
        const three = c.browser();
        yield* Effect.promise(() => three.host.hold(Counter, { session: "S1" }).ready);
        const after = c.origins().filter((origin) => origin !== undefined);
        assert.equal(after.length, 2);
        assert.ok(
          after.some((origin) => !before.has(origin)),
          "a new connection gets a new id",
        );
        yield* Effect.promise(() => c.server.close());
      }),
    ));

  it("an origin a client sends is ignored: the server stamps its own", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const c = cluster();
        const [down, raw] = memoryLinkPair();
        c.server.accept(down, { principal: { guest: "g" } });
        raw.receive(() => {});
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
          token: Counter.description,
          input: { session: "S1" },
          origin: "spoofed",
        });
        yield* Effect.promise(() =>
          until(() => c.sentToWorker().some((frame) => frame.t === "hold")),
        );
        const hold = c.sentToWorker().find((frame) => frame.t === "hold");
        assert.ok(hold?.t === "hold" && hold.origin !== undefined && hold.origin !== "spoofed");
        yield* Effect.promise(() => c.server.close());
      }),
    ));
});

describe("protocol version 4", () => {
  it("a version 3 peer is refused; shapes carry no code version", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { server, browser, link } = setup();
        yield* Effect.promise(() => browser.hold(Notes, {}).ready);
        const shape = link.received.find((frame) => frame.t === "shape");
        assert.ok(shape !== undefined && !("codeVersion" in shape));
        assert.deepEqual(shape.t === "shape" ? [...shape.state].sort() : [], ["notes", "title"]);

        const [down, raw] = memoryLinkPair();
        server.accept(down, { principal: { user: "old" } });
        const closed = new Promise<string>((resolve) => (raw as Link).onClose(resolve));
        raw.receive(() => {});
        raw.send({ t: "hello", protocol: 3, name: "old", kind: "client", codeVersion: 0 });
        assert.equal(yield* Effect.promise(() => closed), `protocol-version ${PROTOCOL_VERSION}`);
        assert.equal(PROTOCOL_VERSION, 4);
        yield* Effect.promise(() => browser.close());
        yield* Effect.promise(() => server.close());
      }),
    ));
});
