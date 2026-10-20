import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import chord from "../src/index.ts";
import type chordTypes from "../src/index.types.ts";

const { createHost, isChordError, local, method } = chord;

const Item = Type.Object({ id: Type.Number(), label: Type.String() });
const Items = Type.Object({ count: Type.Number(), items: Type.Array(Item) });

const List = local("t.list", {
  input: Type.Object({}),
  members: {
    labels: Type.Array(Type.String()),
    list: Items,
    push: method(Item),
    set: method(Items),
  },
  version: 1,
});

function serveList(host: ReturnType<typeof createHost>) {
  host.serve(List, (_input, _principal, self) => {
    const listState = self.state("list", Items, { count: 0, items: [] });
    const labels = self.derive([listState], (list) => list.items.map((item) => item.label));
    return {
      labels,
      list: listState,
      push: (item: { id: number; label: string }, ctx: chordTypes.Ctx) => {
        listState.change(ctx, (draft) => {
          draft.items.push(item);
          draft.count += 1;
        });
      },
      set: (
        value: { items: { id: number; label: string }[]; count: number },
        ctx: chordTypes.Ctx,
      ) => {
        listState.replace(ctx, value);
      },
    };
  });
}

const publishesSnapshotsThenExactOpsDerivations = Effect.gen(function* () {
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  serveList(host);
  const ref = host.hold(List, {});
  const events: chordTypes.StateEvent<unknown>[] = [];
  const labels: chordTypes.StateEvent<unknown>[] = [];
  ref.list.events((event) => events.push(event));
  ref.labels.events((event) => labels.push(event));
  yield* Effect.promise(() => ref.push({ id: 1, label: "a" }));
  assert.deepEqual(events[0], { type: "snap", value: { count: 0, items: [] } });
  const ops = events[1]?.type === "ops" ? events[1].ops.map((op) => JSON.stringify(op)).sort() : [];
  assert.deepEqual(ops, ['["p",["items"],0,0,[{"id":1,"label":"a"}]]', '["s",["count"],1]']);
  assert.deepEqual(events[1]?.value, { count: 1, items: [{ id: 1, label: "a" }] });
  assert.deepEqual(ref.labels.value, ["a"]);
  assert.deepEqual(
    labels.map((event) => event.type),
    ["snap", "ops"],
  );
  yield* Effect.promise(() => ref.set({ count: 0, items: [] }));
  assert.deepEqual(ref.labels.value, []);
});

const supportsPrimitiveCellsAndValueReturning = Effect.gen(function* () {
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  const Counter = local("t.prim", {
    input: Type.Object({}),
    members: { inc: method(undefined, Type.Number()), n: Type.Number() },
    version: 1,
  });
  host.serve(Counter, (_input, _principal, self) => {
    const nState = self.state("n", Type.Number(), 0);
    return {
      inc: (ctx: chordTypes.Ctx) => {
        nState.change(ctx, (n) => n + 1);
        return nState.value;
      },
      n: nState,
    };
  });
  const ref = host.hold(Counter, {});
  const values: unknown[] = [];
  yield* Effect.promise(() => ref.ready);
  const events: chordTypes.StateEvent<unknown>[] = [];
  ref.n.events((event) => events.push(event));
  ref.n.subscribe((value) => values.push(value));
  assert.equal(yield* Effect.promise(() => ref.inc()), 1);
  assert.equal(yield* Effect.promise(() => ref.inc()), 2);
  assert.deepEqual(values, [0, 1, 2]);
  assert.deepEqual(events, [
    { type: "snap", value: 0 },
    { ops: [["r", 1]], type: "ops", value: 1 },
    { ops: [["r", 2]], type: "ops", value: 2 },
  ]);
});

const rejectsAReturnedValueThatDoes = Effect.gen(function* () {
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  const Box = local("t.box", {
    input: Type.Object({}),
    members: { put: method() },
    version: 1,
  });
  host.serve(Box, (_input, _principal, self) => {
    const list = self.state("list", Type.Array(Type.Number()), []);
    return {
      put: (ctx: chordTypes.Ctx) => {
        list.change(ctx, (draft) => draft.push(1) as never);
      },
    };
  });
  yield* Effect.promise(() =>
    assert.rejects(host.hold(Box, {}).put(), (error) => isChordError(error, "invalid")),
  );
});

const validatesInitialValuesAlwaysAndWrites = Effect.gen(function* () {
  const Bad = local("t.bad-initial", { input: Type.Object({}), version: 1 });
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  host.serve(Bad, (_input, _principal, self) => {
    self.state("x", Type.Object({ n: Type.Number() }), { n: "no" } as never);
    return {};
  });
  yield* Effect.promise(() =>
    assert.rejects(host.hold(Bad, {}).ready, /initial value of state x/u),
  );

  const lax = createHost({ onError: () => {}, self: { kind: "host" } });
  serveList(lax);
  yield* Effect.promise(() => lax.hold(List, {}).set({ count: "x", items: [] } as never));

  const dev = createHost({ dev: true, onError: () => {}, self: { kind: "host" } });
  serveList(dev);
  const ref = dev.hold(List, {});
  yield* Effect.promise(() =>
    assert.rejects(
      ref.set({ count: "x", items: [] } as never),
      (error) => isChordError(error, "invalid") && error.reason === "state",
    ),
  );
  assert.deepEqual(ref.list.value, { count: 0, items: [] });
});

const rejectsWritesFromInsideAFactory = Effect.gen(function* () {
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  const Writer = local("t.writer", { input: Type.Object({}), version: 1 });
  let captured: chordTypes.Ctx | undefined;
  yield* Effect.promise(() =>
    host.root((ctx) => {
      captured = ctx;
    }),
  );
  host.serve(Writer, (_input, _principal, self) => {
    const x = self.state("x", Type.Object({}), {});
    const r = self.resource("r", { open: () => 1, version: 1 });
    assert.throws(
      () => r.value,
      (error) => isChordError(error, "not_ready"),
    );
    x.replace(captured!, {});
    return {};
  });
  yield* Effect.promise(() => assert.rejects(host.hold(Writer, {}).ready, /read_only/u));
});

describe("state cells", () => {
  it("publishes snapshots then exact ops; derivations follow", () =>
    Effect.runPromise(publishesSnapshotsThenExactOpsDerivations));

  it("supports primitive cells and value-returning changes", () =>
    Effect.runPromise(supportsPrimitiveCellsAndValueReturning));

  it("rejects a returned value that does not fit the schema, even outside dev mode", () =>
    Effect.runPromise(rejectsAReturnedValueThatDoes));

  it("validates initial values always and writes only in dev mode", () =>
    Effect.runPromise(validatesInitialValuesAlwaysAndWrites));

  it("rejects writes from inside a factory and placeholder use before activation", () =>
    Effect.runPromise(rejectsWritesFromInsideAFactory));
});
