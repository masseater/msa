import { describe, expect, it } from "vite-plus/test";

import { BACKGROUND_CONTEXT } from "../src/context/index.ts";
import { replicatedState } from "../src/index.ts";
import TestSource from "./fixtures/replicated-state.ts";
import type replicatedStateTypes from "./fixtures/replicated-state.types.ts";

const capturesBeforeActivationAndDrainsQueued = (): void => {
  const initial = Object.freeze({ value: 0 });
  const first = Object.freeze({ value: 1 });
  const second = Object.freeze({ value: 2 });
  const firstOps = Object.freeze([["s", ["value"], 1] as const]);
  const secondOps = Object.freeze([["s", ["value"], 2] as const]);
  const source = new TestSource<replicatedStateTypes.SourceValue>(initial, 10);
  source.onAttach = () => {
    source.commit(first, firstOps);
    source.commit(second, secondOps);
  };

  const state = replicatedState(source);
  const deliveries: Array<{ value: replicatedStateTypes.SourceValue; sequence: number }> = [];
  state.subscribe((value, _context, delivery) =>
    deliveries.push({ sequence: delivery.sequence, value }),
  );
  expect(state.value).toBe(second);
  expect(deliveries).toEqual([{ sequence: 2, value: second }]);
};

const hydratesAtSequenceZeroWhenAttaching = (): void => {
  const initial = Object.freeze({ value: 0 });
  const current = Object.freeze({ value: 1 });
  const source = new TestSource<replicatedStateTypes.SourceValue>(initial, 40);
  source.commit(current, Object.freeze([["s", ["value"], 1] as const]));
  const state = replicatedState(source);
  const deliveries: number[] = [];
  state.subscribe((_value, _context, delivery) => deliveries.push(delivery.sequence));
  expect(state.value).toBe(current);
  expect(deliveries).toEqual([0]);
};

const publishesExactSourceValuesWithoutApplying = (): void => {
  const source = new TestSource<replicatedStateTypes.SourceValue>(Object.freeze({ value: 0 }));
  const state = replicatedState(source);
  const next = Object.freeze({ value: 1 });
  const ops = Object.freeze([["s", ["value"], 7] as const]);
  let publishedValue: replicatedStateTypes.SourceValue | undefined;
  state.subscribe((value, _context, delivery) => {
    if (delivery.kind === "update") publishedValue = value;
  });

  source.commit(next, ops);
  expect(state.value).toBe(next);
  expect(publishedValue).toBe(next);
};

const buffersReentrantFramesAndSkipsUpdates = (): void => {
  const source = new TestSource<replicatedStateTypes.SourceValue>(Object.freeze({ value: 0 }));
  const state = replicatedState(source);
  const received: number[] = [];
  const late: Array<{ kind: string; sequence: number; value: number }> = [];
  let nested = false;
  state.subscribe((_value, _context, delivery) => {
    if (delivery.kind !== "update" || delivery.sequence !== 1 || nested) return;
    nested = true;
    source.commit(Object.freeze({ value: 2 }), Object.freeze([["s", ["value"], 2] as const]));
    state.subscribe((lateValue, _lateContext, lateDelivery) =>
      late.push({ ...lateDelivery, value: lateValue.value }),
    );
  });
  state.subscribe((value, _context, delivery) => {
    if (delivery.kind === "update") received.push(value.value);
  });

  source.commit(Object.freeze({ value: 1 }), Object.freeze([["s", ["value"], 1] as const]));
  expect(received).toEqual([1, 2]);
  expect(late).toEqual([{ kind: "hydrate", sequence: 2, value: 2 }]);
};

const reportsListenerFailuresWithoutThrowingThem = (): void => {
  const source = new TestSource<replicatedStateTypes.SourceValue>(Object.freeze({ value: 0 }));
  const errors: Error[] = [];
  const state = replicatedState(source, { onError: (error) => errors.push(error) });
  const received: number[] = [];
  state.subscribe((_value, _context, delivery) => {
    if (delivery.kind === "update") throw new Error("listener failed");
  });
  state.subscribe((value, _context, delivery) => {
    if (delivery.kind === "update") received.push(value.value);
  });

  expect(() =>
    source.commit(Object.freeze({ value: 1 }), Object.freeze([["s", ["value"], 1] as const])),
  ).not.toThrow();
  source.commit(Object.freeze({ value: 2 }), Object.freeze([["s", ["value"], 2] as const]));
  expect(received).toEqual([1, 2]);
  expect(errors.map((error) => error.message)).toEqual(["listener failed", "listener failed"]);
};

const reportsCursorGapsDisposesTheBroken = (): void => {
  const source = new TestSource<replicatedStateTypes.SourceValue>(Object.freeze({ value: 0 }), 5);
  const errors: Error[] = [];
  const state = replicatedState(source, { onError: (error) => errors.push(error) });
  source.commit(
    Object.freeze({ value: 2 }),
    Object.freeze([["s", ["value"], 2] as const]),
    BACKGROUND_CONTEXT,
    7,
  );
  expect(errors[0]?.message).toContain("expected 6, received 7");
  expect(source.attachments.size).toBe(0);
  expect(state.value).toEqual({ value: 0 });
  source.commit(
    Object.freeze({ value: 3 }),
    Object.freeze([["s", ["value"], 3] as const]),
    BACKGROUND_CONTEXT,
    8,
  );
  expect(state.value).toEqual({ value: 0 });
};

const keepsAttachmentsIndependentAndDisposesEach = (): void => {
  const source = new TestSource<replicatedStateTypes.SourceValue>(Object.freeze({ value: 0 }));
  const first = replicatedState(source);
  const second = replicatedState(source);
  expect(source.attachments.size).toBe(2);
  source.commit(Object.freeze({ value: 1 }), Object.freeze([["s", ["value"], 1] as const]));
  expect(first.value.value).toBe(1);
  expect(second.value.value).toBe(1);

  first.dispose();
  first.dispose();
  expect(source.attachments.size).toBe(1);
  source.commit(Object.freeze({ value: 2 }), Object.freeze([["s", ["value"], 2] as const]));
  expect(first.value.value).toBe(1);
  expect(second.value.value).toBe(2);
  second.dispose();
  expect(source.attachments.size).toBe(0);
};

describe("authoritative replicated state sources", () => {
  it(
    "captures before activation and drains queued commits in order",
    capturesBeforeActivationAndDrainsQueued,
  );

  it(
    "hydrates at sequence zero when attaching after existing commits",
    hydratesAtSequenceZeroWhenAttaching,
  );

  it(
    "publishes exact source values without applying or re-diffing",
    publishesExactSourceValuesWithoutApplying,
  );

  it(
    "buffers reentrant frames and skips updates covered by a late hydration",
    buffersReentrantFramesAndSkipsUpdates,
  );

  it(
    "reports listener failures without throwing them into the source",
    reportsListenerFailuresWithoutThrowingThem,
  );

  it(
    "reports cursor gaps, disposes the broken attachment, and ignores later frames",
    reportsCursorGapsDisposesTheBroken,
  );

  it(
    "keeps attachments independent and disposes each idempotently",
    keepsAttachmentsIndependentAndDisposesEach,
  );
});
