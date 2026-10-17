import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import { type Ctx, createHost, type Facet, isChordError, local, method } from "../src/index.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function until(check: () => boolean): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      for (let attempt = 0; attempt < 200 && !check(); attempt++)
        yield* Effect.promise(() => tick());
      assert.ok(check(), "condition not reached");
    }),
  );
}

function latch<T>() {
  let open: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

const Notes = local("t.notes", {
  version: 1,
  input: Type.Object({}),
  members: {
    notes: Type.Array(Type.String()),
    count: Type.Number(),
    has: method(Type.String(), Type.Boolean()),
    add: method(Type.String()),
  },
});

const NotesSchema = Type.Array(Type.String());

const runsAfterTheResourcesAreOpen = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const host = createHost({ self: { kind: "host" }, onError: () => {} });
  const loaded = latch<string[]>();
  const log: string[] = [];
  host.serve(Notes, (_input, _principal, self) => {
    const db = self.resource("db", {
      version: 1,
      open: () => {
        log.push("open");
        return { load: () => loaded.promise };
      },
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
      notes,
      count,
      has: (note) => notes.value.includes(note),
      add: (note, ctx) => {
        notes.change(ctx, (draft) => {
          draft.push(note);
        });
      },
    };
  });
  const ref = host.hold(Notes, {});
  const seen: unknown[] = [];
  ref.notes.subscribe((value) => seen.push(value));
  const has = host.root((ctx) => ref.has("a", ctx));
  yield* Effect.promise(() => until(() => log.includes("init")));
  assert.equal(ref.status, "loading");
  loaded.open(["a", "b"]);
  assert.equal(yield* Effect.promise(() => has), true);
  assert.equal(ref.count.value, 2);
  yield* Effect.promise(() => until(() => log.length === 4));
  assert.deepEqual(log, ["open", "init", "listener a,b", "task a,b"]);
  assert.deepEqual(
    seen.filter((value) => value !== undefined),
    [["a", "b"]],
  );
});

const anInitCellCannotBeRead = Effect.gen(function* () {
  const host = createHost({ self: { kind: "host" }, onError: () => {} });
  host.serve(Notes, (_input, _principal, self) => {
    const notes = self.state("notes", NotesSchema, { init: () => [] });
    const count = self.derive([notes], (list) => list.length);
    void notes.value;
    return { notes, count, has: () => false, add: () => {} };
  });
  yield* Effect.promise(() =>
    assert.rejects(
      host.hold(Notes, {}).ready,
      (error) => isChordError(error) && error.code === "not_ready",
    ),
  );
});

const aThrowingOrInvalidInitFails = Effect.gen(function* () {
  const host = createHost({ self: { kind: "host" }, onError: () => {} });
  let result: () => unknown = () => {
    throw new Error("db down");
  };
  const closed: string[] = [];
  host.serve(Notes, (_input, _principal, self) => {
    self.resource("db", {
      version: 1,
      open: () => "db",
      close: (db) => void closed.push(db),
    });
    const notes = self.state("notes", NotesSchema, { init: () => result() as string[] });
    const count = self.derive([notes], (list) => list.length);
    return { notes, count, has: () => false, add: () => {} };
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
  const host = createHost({ self: { kind: "host" }, onError: () => {} });
  const Source = local("t.source", {
    version: 1,
    input: Type.Object({}),
    members: { all: method(undefined, NotesSchema) },
  });
  host.serve(Source, () => ({ all: () => ["from source"] }));
  host.serve(Notes, (_input, _principal, self) => {
    const notes = self.state("notes", NotesSchema, {
      init: (ctx: Ctx) =>
        Effect.runPromiseWith(services)(
          Effect.gen(function* () {
            const remote = yield* Effect.promise(() => ctx.get(Source, {}));
            return yield* Effect.promise(() => remote.all(ctx));
          }),
        ),
    });
    const count = self.derive([notes], (list) => list.length);
    return { notes, count, has: () => false, add: () => {} };
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

  describe("reload", () => {
    const facet = (spec: {
      readonly inits: string[];
      readonly extra?: () => string[];
      readonly countVersion?: number;
    }): Facet => ({
      name: "notes",
      setup: (api) =>
        api.serve(Notes, (_input, _principal, self) => {
          const notes = self.state("notes", NotesSchema, {
            init: () => {
              spec.inits.push("notes");
              return ["loaded"];
            },
          });
          const counter = self.state("counter", Type.Number(), 0, {
            version: spec.countVersion ?? 1,
          });
          const extra = spec.extra;
          const more =
            extra === undefined
              ? undefined
              : self.state("more", NotesSchema, {
                  init: () => {
                    spec.inits.push("more");
                    return extra();
                  },
                });
          const count = self.derive(
            more === undefined ? [notes, counter] : [notes, counter, more],
            (...lists) =>
              lists.reduce<number>(
                (sum, list) => sum + (typeof list === "number" ? list : list.length),
                0,
              ),
          );
          return {
            notes,
            count,
            has: (note) => notes.value.includes(note),
            add: (note, ctx) => {
              notes.change(ctx, (draft) => {
                draft.push(note);
              });
            },
          };
        }),
    });

    it("keeps an existing cell without running init; a cell the reload adds runs init while it prepares", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const host = createHost({ self: { kind: "host" }, onError: () => {} });
          const inits: string[] = [];
          yield* Effect.promise(() => host.install(facet({ inits })));
          const ref = host.hold(Notes, {});
          yield* Effect.promise(() => ref.ready);
          yield* Effect.promise(() => host.root((ctx) => ref.add("written", ctx)));
          yield* Effect.promise(() => host.reload([facet({ inits, extra: () => ["x", "y"] })]));
          assert.deepEqual(inits, ["notes", "more"]);
          assert.deepEqual(ref.notes.value, ["loaded", "written"]);
          assert.equal(ref.count.value, 4);
        }),
      ));

    it("a failing init of an added cell refuses the reload; the old code keeps running", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const host = createHost({ self: { kind: "host" }, onError: () => {} });
          const inits: string[] = [];
          yield* Effect.promise(() => host.install(facet({ inits })));
          const ref = host.hold(Notes, {});
          yield* Effect.promise(() => ref.ready);
          yield* Effect.promise(() =>
            assert.rejects(
              host.reload([
                facet({
                  inits,
                  extra: () => {
                    throw new Error("cannot load more");
                  },
                }),
              ]),
              /cannot load more/u,
            ),
          );
          assert.equal(ref.count.value, 1);
          assert.equal(
            yield* Effect.promise(() => host.root((ctx) => ref.has("loaded", ctx))),
            true,
          );
        }),
      ));

    it("in a gated reload, an added cell runs init at the gate", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const host = createHost({ self: { kind: "host" }, onError: () => {} });
          const inits: string[] = [];
          yield* Effect.promise(() => host.install(facet({ inits })));
          const ref = host.hold(Notes, {});
          yield* Effect.promise(() => ref.ready);
          const report = yield* Effect.promise(() =>
            host.reload([facet({ inits, countVersion: 2, extra: () => ["x"] })]),
          );
          assert.equal(report.gated.length, 1);
          assert.deepEqual(inits, ["notes", "more"]);
          assert.equal(ref.count.value, 2);
        }),
      ));
  });
});
