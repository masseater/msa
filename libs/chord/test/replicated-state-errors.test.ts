import { Effect } from "effect";
import { describe, expect, test, vi } from "vite-plus/test";

import { BACKGROUND_CONTEXT } from "../src/context/index.ts";
import { replicatedState } from "../src/index.ts";
import replicatedStateDelivery from "./fixtures/replicated-state-delivery.ts";
import type replicatedStateDeliveryTypes from "./fixtures/replicated-state-delivery.types.ts";

const { deferred, fixture } = replicatedStateDelivery;

const isolatesASynchronousHydrationFailureWithout = (
  kind: replicatedStateDeliveryTypes.Kind,
): void => {
  const errors: Error[] = [];
  const { state, publish } = fixture(kind, (error) => errors.push(error));
  const received: number[] = [];
  const failure = new Error("sync hydration");
  expect(() =>
    state.subscribe((value) => {
      received.push(value.value);
      if (value.value === 0) throw failure;
    }),
  ).not.toThrow();
  publish({ value: 1 }, BACKGROUND_CONTEXT);
  expect(errors).toEqual([failure]);
  expect(received).toEqual([0, 1]);
};

const observesHydrationRejectionSynchronousThrowAnd = (kind: replicatedStateDeliveryTypes.Kind) =>
  Effect.gen(function* () {
    const errors: Error[] = [];
    const { state, publish } = fixture(kind, (error) => errors.push(error));
    const gate = deferred();
    const received: number[] = [];
    const fast: number[] = [];
    state.subscribe((value) => {
      received.push(value.value);
      if (value.value === 0) return gate.promise;
      if (value.value === 1) throw new Error("sync update");
      if (value.value === 2) return Promise.reject(new Error("async update"));
      return undefined;
    });
    state.subscribe((value) => fast.push(value.value));
    for (let value = 1; value <= 3; value += 1) publish({ value }, BACKGROUND_CONTEXT);
    gate.reject(new Error("async hydration"));
    yield* Effect.promise(() => vi.waitFor(() => expect(received).toEqual([0, 1, 2, 3])));
    expect(errors.map((error) => error.message)).toEqual([
      "async hydration",
      "sync update",
      "async update",
    ]);
    expect(fast).toEqual([0, 1, 2, 3]);
  });

const stillObservesACallbackRejectionAfter = (kind: replicatedStateDeliveryTypes.Kind) =>
  Effect.gen(function* () {
    const errors: Error[] = [];
    const { state, publish } = fixture(kind, (error) => errors.push(error));
    const gate = deferred();
    const received: number[] = [];
    const stop = state.subscribe((value) => {
      received.push(value.value);
      return gate.promise;
    });
    publish({ value: 1 }, BACKGROUND_CONTEXT);
    stop();
    const failure = new Error("stopped callback");
    gate.reject(failure);
    yield* Effect.promise(() => vi.waitFor(() => expect(errors).toEqual([failure])));
    expect(received).toEqual([0]);
  });

describe("attached listener errors", () => {
  const kind: replicatedStateDeliveryTypes.Kind = "attached";
  test("isolates a synchronous hydration failure without removing the subscription", () => {
    isolatesASynchronousHydrationFailureWithout(kind);
  });

  test("observes hydration rejection, synchronous throw, and update rejection while continuing delivery", () =>
    Effect.runPromise(observesHydrationRejectionSynchronousThrowAnd(kind)));

  test("still observes a callback rejection after unsubscribe", () =>
    Effect.runPromise(stillObservesACallbackRejectionAfter(kind)));
});

test("mutable state reports rejected callbacks through its default error reporter", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const reports: (() => void)[] = [];
      const spy = vi.spyOn(globalThis, "queueMicrotask").mockImplementation((report) => {
        reports.push(report);
      });
      yield* Effect.gen(function* () {
        const state = replicatedState({ value: 0 });
        const failure = new Error("async mutable hydration");
        const received: number[] = [];
        state.subscribe((value) => {
          received.push(value.value);
          if (value.value === 0) return Promise.reject(failure);
          return undefined;
        });
        expect(() => state.replace(BACKGROUND_CONTEXT, { value: 1 })).not.toThrow();
        yield* Effect.promise(() => Promise.resolve());
        expect(received).toEqual([0, 1]);
        expect(reports).toHaveLength(1);
        expect(reports[0]).toThrow(failure);
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            spy.mockRestore();
          }),
        ),
      );
    }),
  ));
