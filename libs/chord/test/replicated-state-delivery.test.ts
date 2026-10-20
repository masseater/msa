import { Effect } from "effect";
import { describe, expect, test, vi } from "vite-plus/test";

import { BACKGROUND_CONTEXT, withCancel } from "../src/context/index.ts";
import { type Context, type ReplicatedStateDelivery } from "../src/index.ts";
import replicatedStateDelivery from "./fixtures/replicated-state-delivery.ts";
import type replicatedStateDeliveryTypes from "./fixtures/replicated-state-delivery.types.ts";

const { deferred, fixture } = replicatedStateDelivery;

const awaitsHydrationAndEachUpdateIndependently = (kind: replicatedStateDeliveryTypes.Kind) =>
  Effect.gen(function* () {
    const services = yield* Effect.context<never>();
    const { state, publish } = fixture(kind);
    const hydration = deferred();
    const update = deferred();
    const events: string[] = [];
    const fast: number[] = [];
    state.subscribe((value) =>
      Effect.runPromiseWith(services)(
        Effect.gen(function* () {
          events.push(`start:${value.value}`);
          if (value.value === 0) yield* Effect.promise(() => hydration.promise);
          if (value.value === 1) yield* Effect.promise(() => update.promise);
          events.push(`end:${value.value}`);
        }),
      ),
    );
    state.subscribe((value) => fast.push(value.value));
    publish({ value: 1 }, BACKGROUND_CONTEXT);
    publish({ value: 2 }, BACKGROUND_CONTEXT);
    expect(events).toEqual(["start:0"]);
    expect(fast).toEqual([0, 1, 2]);
    expect(state.value).toEqual({ value: 2 });
    hydration.resolve();
    yield* Effect.promise(() =>
      vi.waitFor(() => expect(events).toEqual(["start:0", "end:0", "start:1"])),
    );
    update.resolve();
    yield* Effect.promise(() =>
      vi.waitFor(() =>
        expect(events).toEqual(["start:0", "end:0", "start:1", "end:1", "start:2", "end:2"]),
      ),
    );
  });

const excludesARunningUpdateFromOverflow = (kind: replicatedStateDeliveryTypes.Kind) =>
  Effect.gen(function* () {
    const { state, publish } = fixture(kind);
    const gate = deferred();
    const context = withCancel(BACKGROUND_CONTEXT).context;
    const received: {
      value: replicatedStateDeliveryTypes.Value;
      context: Context;
      delivery: ReplicatedStateDelivery;
    }[] = [];
    state.subscribe((value, deliveredContext, delivery) => {
      received.push({ context: deliveredContext, delivery, value });
      if (value.value === 1) return gate.promise;
      return undefined;
    });
    for (let value = 1; value < 102; value += 1) publish({ value }, BACKGROUND_CONTEXT);
    const newest = { value: 102 };
    publish(newest, context);
    const adopted = state.value;
    publish({ value: 103 }, BACKGROUND_CONTEXT);
    expect(received.map(({ value }) => value.value)).toEqual([0, 1]);
    gate.resolve();
    yield* Effect.promise(() => gate.promise);
    expect(received.map(({ value }) => value.value)).toEqual([0, 1, 102, 103]);
    expect(received[2]?.value).toBe(adopted);
    expect(received[2]?.context).toBe(context);
    expect(received[2]?.delivery).toEqual({ kind: "update", sequence: 102 });
  });

const serializesReentrantHydrationAndUpdateCallbacks = (
  kind: replicatedStateDeliveryTypes.Kind,
): void => {
  const { state, publish } = fixture(kind);
  const events: string[] = [];
  state.subscribe((value) => {
    events.push(`start:${value.value}`);
    if (value.value < 2) publish({ value: value.value + 1 }, BACKGROUND_CONTEXT);
    events.push(`end:${value.value}`);
  });
  expect(events).toEqual(["start:0", "end:0", "start:1", "end:1", "start:2", "end:2"]);
};

const treatsTwoSubscriptionsOfTheSame = (kind: replicatedStateDeliveryTypes.Kind) =>
  Effect.gen(function* () {
    const { state, publish } = fixture(kind);
    const gate = deferred();
    const received: number[] = [];
    const listener = (value: replicatedStateDeliveryTypes.Value) => {
      received.push(value.value);
      if (value.value === 0) return gate.promise;
      return undefined;
    };
    const stopFirst = state.subscribe(listener);
    const stopSecond = state.subscribe(listener);
    publish({ value: 1 }, BACKGROUND_CONTEXT);
    stopFirst();
    stopFirst();
    gate.resolve();
    yield* Effect.promise(() => gate.promise);
    expect(received).toEqual([0, 0, 1]);
    stopSecond();
  });

const unsubscribeDropsQueuedCallbacksWithoutJoining = (kind: replicatedStateDeliveryTypes.Kind) =>
  Effect.gen(function* () {
    const { state, publish } = fixture(kind);
    const gate = deferred();
    const { context } = withCancel(BACKGROUND_CONTEXT);
    const received: number[] = [];
    let completed = false;
    const stop = state.subscribe((value) => {
      received.push(value.value);
      if (value.value !== 1) return Promise.resolve();
      return gate.promise.then(() => {
        completed = true;
        return undefined;
      });
    });
    yield* Effect.promise(() => Promise.resolve());
    publish({ value: 1 }, context);
    publish({ value: 2 }, context);
    expect(stop()).toBeUndefined();
    publish({ value: 3 }, context);
    expect(context.abortSignal?.aborted).toBe(false);
    expect(completed).toBe(false);
    gate.resolve();
    yield* Effect.promise(() => vi.waitFor(() => expect(completed).toBe(true)));
    expect(received).toEqual([0, 1]);
  });

describe.each<replicatedStateDeliveryTypes.Kind>(["mutable", "attached"])(
  "%s public delivery",
  (kind) => {
    test("awaits hydration and each update independently of other subscribers", () =>
      Effect.runPromise(awaitsHydrationAndEachUpdateIndependently(kind)));

    test.each([100, 101, 102, 201, 202])("bounds %i pending deliveries", (count) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const { state, publish } = fixture(kind);
          const hydration = deferred();
          const received: number[] = [];
          state.subscribe((value) => {
            received.push(value.value);
            if (value.value === 0) return hydration.promise;
            return undefined;
          });
          for (let value = 1; value <= count; value += 1) publish({ value }, BACKGROUND_CONTEXT);
          expect(received).toEqual([0]);
          hydration.resolve();
          yield* Effect.promise(() => hydration.promise);
          const first = Math.floor((count - 1) / 100) * 100 + 1;
          expect(received).toEqual([
            0,
            ...Array.from({ length: count - first + 1 }, (_, index) => first + index),
          ]);
        }),
      ),
    );

    test("excludes a running update from overflow and retains exact value/context/delivery", () =>
      Effect.runPromise(excludesARunningUpdateFromOverflow(kind)));

    test("serializes reentrant hydration and update callbacks", () => {
      serializesReentrantHydrationAndUpdateCallbacks(kind);
    });

    test("treats two subscriptions of the same callback independently", () =>
      Effect.runPromise(treatsTwoSubscriptionsOfTheSame(kind)));

    test("unsubscribe drops queued callbacks without joining or aborting the running callback", () =>
      Effect.runPromise(unsubscribeDropsQueuedCallbacksWithoutJoining(kind)));
  },
);
