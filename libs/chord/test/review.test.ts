import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import {
  type Facet,
  createHost,
  hostNamed,
  isChordError,
  local,
  method,
  remote,
} from "../src/index.ts";
import review from "./fixtures/review.ts";
import timing from "./fixtures/timing.ts";

const { Item, emitter } = review;
const { ticks } = timing;

const case1AFailingListenerSubscriptionFails = Effect.gen(function* () {
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  const sources = {
    a: emitter<number>(),
    b: emitter<number>({ failSubscribe: true }),
    c: emitter<number>(),
  };
  const facet = (version: string, listen: boolean): Facet => ({
    name: "item",
    setup: (api) =>
      api.serve(Item, ({ id }, _principal, self) => {
        if (listen) self.on("events", sources[id as "a"], () => {});
        return { version: () => version };
      }),
  });
  host.install(facet("v1", false));
  const refs = ["a", "b", "c"].map((id) => host.hold(Item, { id }));
  yield* Effect.promise(() => Promise.all(refs.map((ref) => ref.ready)));
  const codeVersion = host.codeVersion;
  yield* Effect.promise(() => assert.rejects(host.reload([facet("v2", true)]), /subscribe fails/u));
  assert.equal(host.codeVersion, codeVersion);
  assert.deepEqual(yield* Effect.promise(() => Promise.all(refs.map((ref) => ref.version()))), [
    "v1",
    "v1",
    "v1",
  ]);
  assert.equal(sources.a.size, 0);
  assert.equal(sources.c.size, 0);
});

const CountedV1 = remote("t.counted", {
  host: hostNamed("host"),
  input: Type.Object({}),
  variants: { main: { state: { count: Type.Object({ n: Type.Number() }) } } },
  version: 1,
});

const CountedV2 = remote("t.counted", {
  host: hostNamed("host"),
  input: Type.Object({}),
  variants: { main: { state: { count: Type.Object({ total: Type.Number() }) } } },
  version: 2,
});

const case2MigrationIsValidatedAgainstThe = Effect.gen(function* () {
  const host = createHost({ dev: true, onError: () => {}, self: { kind: "host" } });
  host.install({
    name: "counted",
    setup: (api) =>
      api.serve(
        CountedV1,
        (_input, _principal, self) => ({
          count: self.state("count", Type.Object({ n: Type.Number() }), { n: 3 }),
          variant: "main",
        }),
        { linger: 60_000 },
      ),
  });
  const first = host.hold(CountedV1, {});
  yield* Effect.promise(() => first.ready);
  first.release();
  yield* Effect.promise(() =>
    host.reload([
      {
        name: "counted",
        setup: (api) =>
          api.serve(
            CountedV2,
            (_input, _principal, self) => ({
              count: self.state(
                "count",
                Type.Object({ total: Type.Number() }),
                { total: 0 },
                { migrate: (old) => ({ total: (old as { n: number }).n }), version: 2 },
              ),
              variant: "main",
            }),
            { linger: 60_000 },
          ),
      },
    ]),
  );
  const second = host.hold(CountedV2, {});
  const values: unknown[] = [];
  second.count.subscribe((value) => values.push(value));
  yield* Effect.promise(() => second.ready);
  yield* ticks();
  assert.deepEqual(second.count.value, { total: 3 });
});

const case1ACommitThatStillFails = Effect.gen(function* () {
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  host.install({
    name: "item",
    setup: (api) => api.serve(Item, () => ({ version: () => "v1" })),
  });
  const ref = host.hold(Item, { id: "a" });
  yield* Effect.promise(() => ref.ready);
  const objects = (host as unknown as { objects: Map<string, { startTasks(): void }> }).objects;
  for (const object of objects.values()) {
    object.startTasks = () => {
      throw new Error("install step fails");
    };
  }
  yield* Effect.promise(() =>
    assert.rejects(
      host.reload([
        { name: "item", setup: (api) => api.serve(Item, () => ({ version: () => "v2" })) },
      ]),
      /install step fails/u,
    ),
  );
  yield* Effect.promise(() =>
    assert.rejects(
      ref.version(),
      (error) => isChordError(error, "unavailable") && error.reason === "host_failed",
    ),
  );
});

const reentrantObserversCallingAnotherObjectDuring = Effect.gen(function* () {
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  const Other = local("t.other", {
    input: Type.Object({}),
    members: { version: method(undefined, Type.String()) },
    version: 1,
  });
  const facet = (version: string): Facet => ({
    name: "pair",
    setup: (api) => {
      api.serve(Item, () => ({ version: () => version }));
      api.serve(Other, () => ({ version: () => version }));
    },
  });
  host.install(facet("v1"));
  const item = host.hold(Item, { id: "a" });
  const other = host.hold(Other, {});
  yield* Effect.promise(() => Promise.all([item.ready, other.ready]));
  const seen: Promise<string>[] = [];
  item.onShape(() => seen.push(other.version()));
  yield* Effect.promise(() => host.reload([facet("v2")]));
  assert.deepEqual(yield* Effect.promise(() => Promise.all(seen)), ["v2"]);
});

describe("review: reload commit", () => {
  it("#1 a failing listener subscription fails prepare; the code version and all objects stay unchanged", () =>
    Effect.runPromise(case1AFailingListenerSubscriptionFails));

  it("#2 migration is validated against the new remote schemas, not the obsolete ones (dev mode)", () =>
    Effect.runPromise(case2MigrationIsValidatedAgainstThe));

  it("#1 a commit that still fails midway fails the host terminally (no half-published code version serving work)", () =>
    Effect.runPromise(case1ACommitThatStillFails));

  it("reentrant observers calling another object during a commit see the whole new code version", () =>
    Effect.runPromise(reentrantObserversCallingAnotherObjectDuring));
});
