import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import { type Facet, createHost } from "../src/index.ts";
import stateNotes from "./fixtures/state-notes.ts";

const { Notes, NotesSchema } = stateNotes;

const reloadFacet = (spec: {
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
        add: (note, ctx) => {
          notes.change(ctx, (draft) => {
            draft.push(note);
          });
        },
        count,
        has: (note) => notes.value.includes(note),
        notes,
      };
    }),
});

const keepsAnExistingCellWithoutRunning = Effect.gen(function* () {
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  const inits: string[] = [];
  yield* Effect.promise(() => host.install(reloadFacet({ inits })));
  const ref = host.hold(Notes, {});
  yield* Effect.promise(() => ref.ready);
  yield* Effect.promise(() => host.root((ctx) => ref.add("written", ctx)));
  yield* Effect.promise(() => host.reload([reloadFacet({ extra: () => ["x", "y"], inits })]));
  assert.deepEqual(inits, ["notes", "more"]);
  assert.deepEqual(ref.notes.value, ["loaded", "written"]);
  assert.equal(ref.count.value, 4);
});

const aFailingInitOfAnAdded = Effect.gen(function* () {
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  const inits: string[] = [];
  yield* Effect.promise(() => host.install(reloadFacet({ inits })));
  const ref = host.hold(Notes, {});
  yield* Effect.promise(() => ref.ready);
  yield* Effect.promise(() =>
    assert.rejects(
      host.reload([
        reloadFacet({
          extra: () => {
            throw new Error("cannot load more");
          },
          inits,
        }),
      ]),
      /cannot load more/u,
    ),
  );
  assert.equal(ref.count.value, 1);
  assert.equal(yield* Effect.promise(() => host.root((ctx) => ref.has("loaded", ctx))), true);
});

const inAGatedReloadAnAdded = Effect.gen(function* () {
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  const inits: string[] = [];
  yield* Effect.promise(() => host.install(reloadFacet({ inits })));
  const ref = host.hold(Notes, {});
  yield* Effect.promise(() => ref.ready);
  const report = yield* Effect.promise(() =>
    host.reload([reloadFacet({ countVersion: 2, extra: () => ["x"], inits })]),
  );
  assert.equal(report.gated.length, 1);
  assert.deepEqual(inits, ["notes", "more"]);
  assert.equal(ref.count.value, 2);
});

describe("state init", () => {
  describe("reload", () => {
    it("keeps an existing cell without running init; a cell the reload adds runs init while it prepares", () =>
      Effect.runPromise(keepsAnExistingCellWithoutRunning));

    it("a failing init of an added cell refuses the reload; the old code keeps running", () =>
      Effect.runPromise(aFailingInitOfAnAdded));

    it("in a gated reload, an added cell runs init at the gate", () =>
      Effect.runPromise(inAGatedReloadAnAdded));
  });
});
