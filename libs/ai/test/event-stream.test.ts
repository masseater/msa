import { Clock, Effect, Stream } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type { AssistantMessage } from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import { AssistantMessageEventStream, EventStream } from "../src/utils/event-stream.ts";

describe("EventStream", () => {
  it("drains buffered events in order and ignores events pushed after completion", () =>
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
    ));

  it("preserves order when events arrive after buffered draining starts", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const stream = new EventStream<number, number>(
          () => false,
          (event) => event,
        );
        stream.push(1);
        stream.push(2);

        const iterator = stream[Symbol.asyncIterator]();
        expect(yield* Effect.promise(() => iterator.next())).toEqual({ value: 1, done: false });

        stream.push(3);
        expect(yield* Effect.promise(() => iterator.next())).toEqual({ value: 2, done: false });
        expect(yield* Effect.promise(() => iterator.next())).toEqual({ value: 3, done: false });

        stream.end(3);
        expect(yield* Effect.promise(() => iterator.next())).toEqual({
          value: undefined,
          done: true,
        });
      }),
    ));

  it("delivers events to waiting consumers in registration order", () =>
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

        expect(yield* Effect.promise(() => firstEvent)).toEqual({ value: 1, done: false });
        expect(yield* Effect.promise(() => secondEvent)).toEqual({ value: 2, done: false });
      }),
    ));

  it("drains buffered events after end and resolves the explicit result", () =>
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
    ));

  it("wakes all waiting consumers when ended without a result", () =>
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

        expect(yield* Effect.promise(() => firstEvent)).toEqual({ value: undefined, done: true });
        expect(yield* Effect.promise(() => secondEvent)).toEqual({ value: undefined, done: true });
      }),
    ));
});

function message(timestamp: number, durationMs?: number): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai-responses",
    provider: "openai",
    model: "m",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp,
    ...(durationMs === undefined ? {} : { durationMs }),
  };
}

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe("AssistantMessageEventStream timing", () => {
  it("sets durationMs on the final done or error message of a response it saw start", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const done = new AssistantMessageEventStream();
        const answer = message(yield* Clock.currentTimeMillis);
        yield* Effect.promise(() => sleep(20));
        done.push({ type: "done", reason: "stop", message: answer });
        expect(answer.durationMs).toBeGreaterThanOrEqual(15);
        expect((yield* Effect.promise(() => done.result())).durationMs).toBe(answer.durationMs);

        const failed = new AssistantMessageEventStream();
        const error = { ...message(yield* Clock.currentTimeMillis), stopReason: "error" as const };
        failed.push({ type: "error", reason: "error", error });
        expect(error.durationMs).toBeGreaterThanOrEqual(0);

        const ended = new AssistantMessageEventStream();
        const result = message(yield* Clock.currentTimeMillis);
        ended.end(result);
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
      }),
    ));

  it("keeps an existing duration, so a forwarding stream keeps the inner measurement", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const outer = new AssistantMessageEventStream();
        yield* Effect.promise(() => sleep(20));
        const inner = new AssistantMessageEventStream();
        const answer = message(yield* Clock.currentTimeMillis);
        inner.push({ type: "done", reason: "stop", message: answer });
        const measured = answer.durationMs;
        outer.push({ type: "done", reason: "stop", message: answer });
        expect(answer.durationMs).toBe(measured);
        expect(measured).toBeLessThan(20);

        const preset = message(yield* Clock.currentTimeMillis, 1234);
        new AssistantMessageEventStream().push({ type: "done", reason: "stop", message: preset });
        expect(preset.durationMs).toBe(1234);
      }),
    ));

  it("leaves a message untimed when it started before the stream, such as a fetched deferred result", () => {
    const fetched = message(currentTimeMillis() - 60_000);
    new AssistantMessageEventStream().push({ type: "done", reason: "stop", message: fetched });
    expect(fetched.durationMs).toBeUndefined();
  });

  it("does not time a message pushed after the stream completed", () => {
    const stream = new AssistantMessageEventStream();
    stream.push({ type: "done", reason: "stop", message: message(currentTimeMillis()) });
    const late = message(currentTimeMillis());
    stream.push({ type: "done", reason: "stop", message: late });
    expect(late.durationMs).toBeUndefined();
  });
});
