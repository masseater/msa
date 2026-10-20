import { Clock, Effect, Stream } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type { AssistantMessage } from "../src/types.ts";
import { EventStream } from "../src/utils/async-event-stream.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";

const drainsBufferedEventsInOrderAnd = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const stream = new EventStream<number, number>(
        (event) => event === 3,
        (event) => event,
      );
      stream.push(1);
      stream.push(2);
      stream.push(3);
      stream.push(4);

      expect(yield* Effect.promise(() => stream.result())).toBe(3);

      const events: number[] = [];
      yield* Stream.fromAsyncIterable(stream, (error) => error).pipe(
        Stream.orDie,
        Stream.runForEach((event) =>
          Effect.sync(() => {
            events.push(event);
          }),
        ),
      );
      expect(events).toEqual([1, 2, 3]);
    }),
  );

const preservesOrderWhenEventsArriveAfter = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const stream = new EventStream<number, number>(
        () => false,
        (event) => event,
      );
      stream.push(1);
      stream.push(2);

      const iterator = stream[Symbol.asyncIterator]();
      expect(yield* Effect.promise(() => iterator.next())).toEqual({ done: false, value: 1 });

      stream.push(3);
      expect(yield* Effect.promise(() => iterator.next())).toEqual({ done: false, value: 2 });
      expect(yield* Effect.promise(() => iterator.next())).toEqual({ done: false, value: 3 });

      stream.end(3);
      expect(yield* Effect.promise(() => iterator.next())).toEqual({
        done: true,
        value: undefined,
      });
    }),
  );

const deliversEventsToWaitingConsumersIn = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const stream = new EventStream<number, number>(
        () => false,
        (event) => event,
      );
      const firstIterator = stream[Symbol.asyncIterator]();
      const secondIterator = stream[Symbol.asyncIterator]();
      const firstEvent = firstIterator.next();
      const secondEvent = secondIterator.next();

      stream.push(1);
      stream.push(2);

      expect(yield* Effect.promise(() => firstEvent)).toEqual({ done: false, value: 1 });
      expect(yield* Effect.promise(() => secondEvent)).toEqual({ done: false, value: 2 });
    }),
  );

const drainsBufferedEventsAfterEndAnd = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const stream = new EventStream<number, string>(
        () => false,
        (event) => String(event),
      );
      stream.push(1);
      stream.push(2);
      stream.end("complete");

      expect(yield* Effect.promise(() => stream.result())).toBe("complete");

      const events: number[] = [];
      yield* Stream.fromAsyncIterable(stream, (error) => error).pipe(
        Stream.orDie,
        Stream.runForEach((event) =>
          Effect.sync(() => {
            events.push(event);
          }),
        ),
      );
      expect(events).toEqual([1, 2]);
    }),
  );

const wakesAllWaitingConsumersWhenEnded = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const stream = new EventStream<number, number>(
        () => false,
        (event) => event,
      );
      const firstIterator = stream[Symbol.asyncIterator]();
      const secondIterator = stream[Symbol.asyncIterator]();
      const firstEvent = firstIterator.next();
      const secondEvent = secondIterator.next();

      stream.end();

      expect(yield* Effect.promise(() => firstEvent)).toEqual({ done: true, value: undefined });
      expect(yield* Effect.promise(() => secondEvent)).toEqual({ done: true, value: undefined });
    }),
  );

describe("EventStream", () => {
  it(
    "drains buffered events in order and ignores events pushed after completion",
    drainsBufferedEventsInOrderAnd,
  );

  it(
    "preserves order when events arrive after buffered draining starts",
    preservesOrderWhenEventsArriveAfter,
  );

  it(
    "delivers events to waiting consumers in registration order",
    deliversEventsToWaitingConsumersIn,
  );

  it(
    "drains buffered events after end and resolves the explicit result",
    drainsBufferedEventsAfterEndAnd,
  );

  it("wakes all waiting consumers when ended without a result", wakesAllWaitingConsumersWhenEnded);
});

function message(timestamp: number, durationMs?: number): AssistantMessage {
  return {
    api: "openai-responses",
    content: [],
    model: "m",
    provider: "openai",
    role: "assistant",
    stopReason: "stop",
    timestamp,
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
    ...(durationMs === undefined ? {} : { durationMs }),
  };
}

const sleep = (ms: number) => Effect.runPromise(Effect.sleep(ms));

const setsDurationMsOnTheFinalDone = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const done = new AssistantMessageEventStream();
      const answer = message(yield* Clock.currentTimeMillis);
      yield* Effect.promise(() => sleep(20));
      done.push({ message: answer, reason: "stop", type: "done" });
      expect(answer.durationMs).toBeGreaterThanOrEqual(15);
      expect((yield* Effect.promise(() => done.result())).durationMs).toBe(answer.durationMs);

      const failed = new AssistantMessageEventStream();
      const error = { ...message(yield* Clock.currentTimeMillis), stopReason: "error" as const };
      failed.push({ error, reason: "error", type: "error" });
      expect(error.durationMs).toBeGreaterThanOrEqual(0);

      const ended = new AssistantMessageEventStream();
      const result = message(yield* Clock.currentTimeMillis);
      ended.end(result);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }),
  );

const keepsAnExistingDurationSoA = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const outer = new AssistantMessageEventStream();
      yield* Effect.promise(() => sleep(20));
      const inner = new AssistantMessageEventStream();
      const answer = message(yield* Clock.currentTimeMillis);
      inner.push({ message: answer, reason: "stop", type: "done" });
      const measured = answer.durationMs;
      outer.push({ message: answer, reason: "stop", type: "done" });
      expect(answer.durationMs).toBe(measured);
      expect(measured).toBeLessThan(20);

      const preset = message(yield* Clock.currentTimeMillis, 1234);
      new AssistantMessageEventStream().push({ message: preset, reason: "stop", type: "done" });
      expect(preset.durationMs).toBe(1234);
    }),
  );

const leavesAMessageUntimedWhenIt = () => {
  const fetched = message(currentTimeMillis() - 60_000);
  new AssistantMessageEventStream().push({ message: fetched, reason: "stop", type: "done" });
  expect(fetched.durationMs).toBeUndefined();
};

const doesNotTimeAMessagePushed = () => {
  const stream = new AssistantMessageEventStream();
  stream.push({ message: message(currentTimeMillis()), reason: "stop", type: "done" });
  const late = message(currentTimeMillis());
  stream.push({ message: late, reason: "stop", type: "done" });
  expect(late.durationMs).toBeUndefined();
};

describe("AssistantMessageEventStream timing", () => {
  it(
    "sets durationMs on the final done or error message of a response it saw start",
    setsDurationMsOnTheFinalDone,
  );

  it(
    "keeps an existing duration, so a forwarding stream keeps the inner measurement",
    keepsAnExistingDurationSoA,
  );

  it(
    "leaves a message untimed when it started before the stream, such as a fetched deferred result",
    leavesAMessageUntimedWhenIt,
  );

  it("does not time a message pushed after the stream completed", doesNotTimeAMessagePushed);
});
