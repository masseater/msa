import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import { createHost, hostNamed, local, memoryLinkPair, method, remote } from "../src/index.ts";
import bindings from "./fixtures/bindings.ts";
import counting from "./fixtures/counting.ts";
import timing from "./fixtures/timing.ts";

const { NoteSchema, Notes, setup, until } = bindings;
const { CountingLink, stateFrames } = counting;
const { tick } = timing;

const Panel = local("t.e8-panel", {
  input: Type.Object({}),
  members: { count: Type.Number() },
  version: 1,
});

const nReferencesToOneObjectOne = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const { server, browser, link } = setup();
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
  yield* until(
    () => a.notes.value.length === 1 && b.notes.value.length === 1 && panel.count.value === 1,
  );
  yield* tick;
  assert.equal(
    stateFrames(link.received).length - before,
    1,
    "one delta frame for one change, whatever N",
  );

  const sent = link.traffic("sent").length;
  a.release();
  panel.release();
  yield* Effect.sleep(5);
  assert.equal(link.traffic("sent").length, sent, "releasing all but one reference sends nothing");
  b.release();
  yield* until(() => link.count("sent", "release") === 1);
  yield* Effect.promise(() => browser.close());
  yield* Effect.promise(() => server.close());
});

const aHeldReferenceStaysSubscribedWithout = Effect.gen(function* () {
  const { server, browser } = setup();
  const notes = browser.hold(Notes, {});
  yield* Effect.promise(() => notes.ready);
  assert.deepEqual(notes.notes.value, []);
  yield* Effect.promise(() => notes.add("bread"));
  yield* until(() => notes.notes.value.length === 1);
  assert.equal(notes.title.value, "untitled");
  yield* Effect.promise(() => browser.close());
  yield* Effect.promise(() => server.close());
});

describe("shared bindings: traffic", () => {
  it("N references to one object: one hold, one snapshot per member, one frame per change, one release", () =>
    Effect.runPromise(nReferencesToOneObjectOne));

  it("a held reference stays subscribed without listeners; values are readable at once after ready", () =>
    Effect.runPromise(aHeldReferenceStaysSubscribedWithout));
});

const aLingeringBindingKeepsItsHold = Effect.gen(function* () {
  const { server, browser, link } = setup({ linger: { types: { [Notes.name]: 40 } } });
  const first = yield* Effect.promise(() => browser.get(Notes, {}));
  const frames = link.traffic("received").length;
  first.release();
  yield* Effect.sleep(10);
  assert.equal(link.count("sent", "release"), 0, "not released before the linger");
  for (let i = 0; i < 3; i++) {
    const again = yield* Effect.promise(() => browser.get(Notes, {}));
    assert.deepEqual(again.notes.value, []);
    again.release();
  }
  assert.equal(link.count("sent", "hold"), 1);
  assert.equal(link.traffic("received").length, frames, "nothing new crossed the link");
  yield* until(() => link.count("sent", "release") === 1);
  yield* Effect.promise(() => browser.close());
  yield* Effect.promise(() => server.close());
});

const atMostCapBindingsLingerThe = Effect.gen(function* () {
  const { server, browser, link } = setup({
    linger: { cap: 1, types: { [Notes.name]: 10_000 } },
  });
  const a = yield* Effect.promise(() => browser.get(Notes, { list: "a" }));
  const b = yield* Effect.promise(() => browser.get(Notes, { list: "b" }));
  a.release();
  yield* Effect.sleep(5);
  assert.equal(link.count("sent", "release"), 0);
  b.release();
  yield* until(() => link.count("sent", "release") === 1);
  const release = link.sent.find((frame) => frame.t === "release");
  const holdOfA = link.sent.find(
    (frame) => frame.t === "hold" && (frame.input as { list: string }).list === "a",
  );
  assert.equal(release?.t === "release" ? release.id : 0, holdOfA?.t === "hold" ? holdOfA.id : -1);
  yield* Effect.promise(() => browser.close());
  yield* Effect.promise(() => server.close());
});

describe("shared bindings: linger", () => {
  it("a lingering binding keeps its hold and state; a reference taken meanwhile costs nothing on the link", () =>
    Effect.runPromise(aLingeringBindingKeepsItsHold));

  it("at most `cap` bindings linger: the least recently released goes first", () =>
    Effect.runPromise(atMostCapBindingsLingerThe));
});

const NotesV2 = remote("t.e8-notes", {
  host: hostNamed("server"),
  input: Type.Object({ list: Type.Optional(Type.String({ default: "main" })) }),
  variants: {
    main: {
      methods: {
        add: method(Type.String()),
        clear: method(),
        rename: method(Type.String()),
      },
      state: { notes: NoteSchema, title: Type.String() },
    },
  },
  version: 2,
});

const normalizedEqualInputsAndEqualPrincipal = Effect.gen(function* () {
  const server = createHost({
    name: "server",
    onError: () => {},
    self: { kind: "host" },
  });
  server.serve(
    NotesV2,
    (_input, _principal, self) => {
      const notes = self.state("notes", NoteSchema, []);
      const title = self.state("title", Type.String(), "untitled");
      return {
        add: () => {},
        clear: () => {},
        notes,
        rename: () => {},
        title,
        variant: "main",
      };
    },
    { accepts: { 1: (current) => current } },
  );
  const [down, up] = memoryLinkPair();
  server.accept(down, { kind: "host", name: "session:w", principal: { worker: "w" } });
  const link = new CountingLink(up);
  const worker = createHost<unknown>({
    name: "session:w",
    onError: () => {},
    self: { kind: "host" },
    upstream: { link, principal: { kind: "server" } },
  });
  const refs = [
    worker.hold(Notes, {}),
    worker.hold(Notes, { list: "main" }),
    worker.hold(Notes, {}, { principal: { grant: 1, user: "a" } }),
    worker.hold(Notes, {}, { principal: { grant: 1, user: "a" } }),
    worker.hold(Notes, {}, { principal: { grant: 2, user: "a" } }),
    worker.hold(NotesV2, {}),
  ];
  yield* Effect.promise(() => Promise.all(refs.map((ref) => ref.ready)));
  assert.equal(link.count("sent", "hold"), 4);
  yield* Effect.promise(() => worker.close());
  yield* Effect.promise(() => server.close());
});

describe("shared bindings: identity", () => {
  it("normalized-equal inputs and equal principal keys share; other principals and fingerprints do not", () =>
    Effect.runPromise(normalizedEqualInputsAndEqualPrincipal));
});
