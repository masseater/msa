import assert from "node:assert/strict";

import { type Context, Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import chord from "../src/index.ts";
import type chordTypes from "../src/index.types.ts";
import stateNotes from "./fixtures/state-notes.ts";
import timing from "./fixtures/timing.ts";
import type timingTypes from "./fixtures/timing.types.ts";

const { createHost, isChordError, local, method } = chord;

const { Notes, NotesSchema } = stateNotes;
const { latch, pollUntil, tick } = timing;

const until = (check: () => boolean) => pollUntil(check, 200, tick);

const serveLoadingNotes = (
  host: chordTypes.Host,
  loaded: timingTypes.Latch<string[]>,
  log: string[],
  services: Context.Context<never>,
): void => {
  host.serve(Notes, (_input, _principal, self) => {
    const db = self.resource("db", {
      open: () => {
        log.push("open");
        return { load: () => loaded.promise };
      },
      version: 1,
    });
    const notes = self.state("notes", NotesSchema, {
      init: () =>
        Effect.runPromiseWith(services)(
          Effect.gen(function* () {
            log.push("init");
            return yield* Effect.promise(() => db.value.load());
          }),
        ),
    });
    const count = self.derive([notes], (list) => list.length);
    self.on("notes", notes, (list) => {
      log.push(`listener ${list.join(",")}`);
    });
    self.task(() =>
      Effect.runPromiseWith(services)(
        Effect.sync(() => {
          log.push(`task ${notes.value.join(",")}`);
        }),
      ),
    );
    return {
      add: (note, ctx) => {
        notes.change(ctx, (draft) => {
          draft.push(note);
        });
      },
      count,
      has: (note) => notes.value.includes(note),
      notes,
    };
  });
};

const runsAfterTheResourcesAreOpen = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  const loaded = latch<string[]>();
  const log: string[] = [];
  serveLoadingNotes(host, loaded, log, services);
  const ref = host.hold(Notes, {});
  const seen: unknown[] = [];
  ref.notes.subscribe((value) => seen.push(value));
  const has = host.root((ctx) => ref.has("a", ctx));
  yield* until(() => log.includes("init"));
  assert.equal(ref.status, "loading");
  loaded.open(["a", "b"]);
  assert.equal(yield* Effect.promise(() => has), true);
  assert.equal(ref.count.value, 2);
  yield* until(() => log.length === 4);
  assert.deepEqual(log, ["open", "init", "listener a,b", "task a,b"]);
  assert.deepEqual(
    seen.filter((value) => value !== undefined),
    [["a", "b"]],
  );
});

const anInitCellCannotBeRead = Effect.gen(function* () {
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  host.serve(Notes, (_input, _principal, self) => {
    const notes = self.state("notes", NotesSchema, { init: () => [] });
    const count = self.derive([notes], (list) => list.length);
    void notes.value;
    return { add: () => {}, count, has: () => false, notes };
  });
  yield* Effect.promise(() =>
    assert.rejects(
      host.hold(Notes, {}).ready,
      (error) => isChordError(error) && error.code === "not_ready",
    ),
  );
});

const aThrowingOrInvalidInitFails = Effect.gen(function* () {
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  let result: () => unknown = () => {
    throw new Error("db down");
  };
  const closed: string[] = [];
  host.serve(Notes, (_input, _principal, self) => {
    self.resource("db", {
      close: (db) => void closed.push(db),
      open: () => "db",
      version: 1,
    });
    const notes = self.state("notes", NotesSchema, { init: () => result() as string[] });
    const count = self.derive([notes], (list) => list.length);
    return { add: () => {}, count, has: () => false, notes };
  });
  yield* Effect.promise(() => assert.rejects(host.hold(Notes, {}).ready, /db down/u));
  assert.deepEqual(closed, ["db"]);
  result = () => [1];
  yield* Effect.promise(() =>
    assert.rejects(
      host.hold(Notes, {}).ready,
      (error) => isChordError(error) && error.code === "invalid",
    ),
  );
  assert.deepEqual(closed, ["db", "db"]);
  result = () => ["ok"];
  const ref = host.hold(Notes, {});
  yield* Effect.promise(() => ref.ready);
  assert.deepEqual(ref.notes.value, ["ok"]);
});

const initRunsInARootIt = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  const Source = local("t.source", {
    input: Type.Object({}),
    members: { all: method(undefined, NotesSchema) },
    version: 1,
  });
  host.serve(Source, () => ({ all: () => ["from source"] }));
  host.serve(Notes, (_input, _principal, self) => {
    const notes = self.state("notes", NotesSchema, {
      init: (ctx: chordTypes.Ctx) =>
        Effect.runPromiseWith(services)(
          Effect.gen(function* () {
            const remote = yield* Effect.promise(() => ctx.get(Source, {}));
            return yield* Effect.promise(() => remote.all(ctx));
          }),
        ),
    });
    const count = self.derive([notes], (list) => list.length);
    return { add: () => {}, count, has: () => false, notes };
  });
  const ref = host.hold(Notes, {});
  yield* Effect.promise(() => ref.ready);
  assert.deepEqual(ref.notes.value, ["from source"]);
});

describe("state init", () => {
  it("runs after the resources are open and before the object goes live: nothing sees another value", () =>
    Effect.runPromise(runsAfterTheResourcesAreOpen));

  it("an init cell cannot be read inside the factory", () =>
    Effect.runPromise(anInitCellCannotBeRead));

  it("a throwing or invalid init fails the activation and closes its resources; the next get tries again", () =>
    Effect.runPromise(aThrowingOrInvalidInitFails));

  it("init runs in a root: it can call other objects", () => Effect.runPromise(initRunsInARootIt));
});
