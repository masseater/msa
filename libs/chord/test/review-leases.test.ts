import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import { createHost, defineRegistry, isChordError, local, method, type Ref } from "../src/index.ts";
import { emitter } from "./fixtures/review.ts";
import { latch, tick, ticks } from "./fixtures/timing.ts";

const case5DisposalWaitsForRunningMethods = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const Worker = local("t.busy", {
    version: 1,
    input: Type.Object({ id: Type.String() }),
    members: { work: method(undefined, Type.Boolean()) },
  });
  const log: string[] = [];
  let go = latch();
  const host = createHost({ self: { kind: "host" }, onError: () => {} });
  host.serve(Worker, ({ id }, _principal, self) => {
    const connResource = self.resource("conn", {
      version: 1,
      open: () => ({ closed: false }),
      close: (conn) => {
        conn.closed = true;
        log.push(`close ${id}`);
      },
    });
    return {
      work: () =>
        Effect.runPromiseWith(services)(
          Effect.gen(function* () {
            yield* go.wait;
            log.push(`done ${id}`);
            return connResource.value.closed;
          }),
        ),
    };
  });
  const released = host.hold(Worker, { id: "r" });
  const call = released.work();
  yield* ticks();
  released.release();
  yield* ticks();
  go.open();
  assert.equal(yield* Effect.promise(() => call), false);
  yield* ticks();
  assert.deepEqual(log, ["done r", "close r"]);

  go = latch();
  log.length = 0;
  const forced = host.hold(Worker, { id: "f" }, { principal: { user: "u" } });
  const forcedCall = forced.work();
  yield* ticks();
  const invalidated = host.invalidatePrincipal(
    (principal) => (principal as { user?: string }).user === "u",
  );
  yield* ticks();
  assert.equal(forced.status, "gone");
  assert.deepEqual(log, []);
  go.open();
  yield* Effect.promise(() => invalidated);
  assert.equal(yield* Effect.promise(() => forcedCall), false);
  assert.deepEqual(log, ["done f", "close f"]);
});

const case6ARegistryConflictFoundWhile = Effect.gen(function* () {
  const errors: unknown[] = [];
  const host = createHost({ self: { kind: "host" }, onError: (error) => errors.push(error) });
  const Routes = defineRegistry<string>("t.review-routes");
  const log: string[] = [];
  const types = ["t.eager-a", "t.eager-b"].map((name) =>
    local(name, { version: 1, input: Type.Object({}) }),
  );
  for (const type of types) {
    host.serve(
      type,
      (_input, _principal, self) => {
        self.resource("r", {
          version: 1,
          open: () => void log.push(`open ${type.name}`),
          close: () => void log.push(`close ${type.name}`),
        });
        self.register(Routes, { same: type.name });
        return {};
      },
      { lifetime: "host" },
    );
  }
  yield* ticks(20);
  assert.equal(log.filter((entry) => entry.startsWith("open")).length, 2);
  assert.equal(log.filter((entry) => entry.startsWith("close")).length, 1);
  assert.equal(host.registry(Routes).table().size, 1);
  assert.ok(
    errors.some((error) => isChordError(error, "invalid") && error.reason === "registry_conflict"),
  );
});

describe("review: leases, invocations, activation", () => {
  const Store = local("t.store", {
    version: 1,
    input: Type.Object({}),
    members: { count: Type.Unknown() },
  });

  it("#4 a running listener holds a lease: the gate waits for it before migrating", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const services = yield* Effect.context<never>();
        const host = createHost({ self: { kind: "host" }, onError: () => {} });
        const events = emitter<number>();
        const go = latch();
        const seen: unknown[] = [];
        host.install({
          name: "store",
          setup: (api) =>
            api.serve(Store, (_input, _principal, self) => {
              const count = self.state("count", Type.Object({ n: Type.Number() }), { n: 1 });
              self.on("slow", events, () =>
                Effect.runPromiseWith(services)(
                  Effect.gen(function* () {
                    yield* go.wait;
                    seen.push(count.value);
                  }),
                ),
              );
              return { count };
            }),
        });
        const ref = host.hold(Store, {});
        yield* Effect.promise(() => ref.ready);
        events.emit(1);
        yield* tick;
        const codeVersion = host.codeVersion;
        const reload = host.reload(
          [
            {
              name: "store",
              setup: (api) =>
                api.serve(Store, (_input, _principal, self) => ({
                  count: self.state(
                    "count",
                    Type.Object({ total: Type.Number() }),
                    { total: 0 },
                    { version: 2, migrate: (old) => ({ total: (old as { n: number }).n }) },
                  ),
                })),
            },
          ],
          { gateDeadline: 2000 },
        );
        yield* ticks(20);
        assert.equal(host.codeVersion, codeVersion, "the gate must wait for the listener");
        go.open();
        yield* Effect.promise(() => reload);
        assert.deepEqual(seen, [{ n: 1 }]);
        assert.deepEqual(ref.count.value, { total: 1 });
      }),
    ));

  it("#5 disposal waits for running methods before closing resources (released and forced)", () =>
    Effect.runPromise(case5DisposalWaitsForRunningMethods));

  it("#6 a registry conflict found while finalizing activation unwinds the loser completely", () =>
    Effect.runPromise(case6ARegistryConflictFoundWhile));

  it("#6 releasing the last hold while listeners start up does not resurrect the object", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const host = createHost({ self: { kind: "host" }, onError: () => {} });
        const log: string[] = [];
        let ref: Ref<typeof Store> | undefined;
        let runs = 0;
        host.serve(Store, (_input, _principal, self) => {
          runs++;
          const count = self.state("count", Type.Number(), 0);
          self.resource("r", {
            version: 1,
            open: () => void log.push("open"),
            close: () => void log.push("close"),
          });
          self.on("drop", count, () => ref?.release());
          return { count };
        });
        const held = host.hold(Store, {});
        ref = held;
        yield* Effect.promise(() => held.ready.catch(() => {}));
        yield* ticks(20);
        assert.deepEqual(log, ["open", "close"]);
        const again = host.hold(Store, {});
        ref = undefined;
        yield* Effect.promise(() => again.ready);
        assert.equal(runs, 2);
      }),
    ));
});
