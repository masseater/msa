import assert from "node:assert/strict";

import { Effect } from "effect";
import { describe, it } from "vite-plus/test";

import chord from "../src/index.ts";
import type chordTypes from "../src/index.types.ts";
import link from "./fixtures/link.ts";
import timing from "./fixtures/timing.ts";

const { isChordError } = chord;

const { Counter, SessionCounter, serveCounter, serverWithWorker } = link;
const { tick } = timing;

const aChildCallsTheServerThe = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const { server, worker } = serverWithWorker();
  const principals: unknown[] = [];
  serveCounter(server, principals);
  const result = yield* Effect.promise(() =>
    worker.root((ctx) =>
      Effect.runPromiseWith(services)(
        Effect.gen(function* () {
          const counter = yield* Effect.promise(() => ctx.get(Counter, { name: "c" }));
          assert.equal(counter.variant, "main");
          return [
            yield* Effect.promise(() => counter.add(2, ctx)),
            yield* Effect.promise(() => counter.who(ctx)),
          ];
        }),
      ),
    ),
  );
  assert.deepEqual(result, [2, { worker: "session:S1" }]);
  assert.deepEqual(principals, [{ worker: "session:S1" }]);
});

const stateMembersSnapshotThenDeltaEncoded = Effect.gen(function* () {
  const { server, worker } = serverWithWorker();
  serveCounter(server);
  const counter = worker.hold(Counter, { name: "s" });
  const events: chordTypes.StateEvent<unknown>[] = [];
  const values: unknown[] = [];
  counter.count.events((event) => events.push(event));
  counter.count.subscribe((value) => values.push(value));
  yield* Effect.promise(() => counter.ready);
  yield* Effect.promise(() => counter.add(1));
  yield* Effect.promise(() => counter.add(1));
  yield* tick;
  assert.deepEqual(counter.count.value, { n: 2 });
  assert.deepEqual(
    events.map((event) => event.type),
    ["snap", "ops", "ops"],
  );
  assert.deepEqual(values, [{ n: 0 }, { n: 1 }, { n: 2 }]);
});

const theServerReachesAConnectedChild = Effect.gen(function* () {
  const { server, worker } = serverWithWorker("session:w1");
  const principals: unknown[] = [];
  serveCounter(worker, principals);
  yield* tick;
  const counter = server.hold(SessionCounter, { name: "x", session: "w1" });
  assert.equal(yield* Effect.promise(() => counter.add(5)), 5);
  assert.deepEqual(principals, [{ kind: "server" }]);
});

const rejectsLocalTypesAndUnknownHosts = Effect.gen(function* () {
  const { worker } = serverWithWorker();
  const missing = worker.hold(Counter, { name: "m" });
  yield* Effect.promise(() =>
    assert.rejects(missing.ready, (error) => isChordError(error, "unavailable")),
  );
});

describe("links: calls and state across hosts", () => {
  it("a child calls the server; the server stamps the child's principal", () =>
    Effect.runPromise(aChildCallsTheServerThe));

  it("state members: snapshot, then delta-encoded ops; values decode to the provider's", () =>
    Effect.runPromise(stateMembersSnapshotThenDeltaEncoded));

  it("the server reaches a connected child by name", () =>
    Effect.runPromise(theServerReachesAConnectedChild));

  it("rejects local types and unknown hosts", () =>
    Effect.runPromise(rejectsLocalTypesAndUnknownHosts));
});
