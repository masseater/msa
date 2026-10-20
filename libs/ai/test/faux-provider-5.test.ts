import { Clock, Effect, Stream } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import compat from "../src/compat.ts";
import fauxProviderSupport from "./faux-provider-support.ts";

const { fauxAssistantMessage, registerFauxProvider, stream } = compat;

const { collectEvents, registrations } = fauxProviderSupport;

afterEach(() => {
  for (const registration of registrations.splice(0)) {
    registration.unregister();
  }
});

const streamsAnExplicitAssistantAbortedMessage = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registration = registerFauxProvider({ tokenSize: { max: 2, min: 2 } });
      registrations.push(registration);
      registration.setResponses([
        {
          ...fauxAssistantMessage("partial"),
          errorMessage: "Request was aborted",
          stopReason: "aborted",
        },
      ]);

      const currentTime9 = yield* Clock.currentTimeMillis;
      const events = yield* Effect.promise(() =>
        collectEvents(
          stream(registration.getModel(), {
            messages: [{ content: "hi", role: "user", timestamp: currentTime9 }],
          }),
        ),
      );

      expect(events.map((event) => event.type)).toEqual([
        "start",
        "text_start",
        "text_delta",
        "text_end",
        "error",
      ]);
      const terminal = events.at(-1);
      expect(terminal?.type).toBe("error");
      if (terminal?.type === "error") {
        expect(terminal.reason).toBe("aborted");
        expect(terminal.error.stopReason).toBe("aborted");
        expect(terminal.error.errorMessage).toBe("Request was aborted");
      }
    }),
  );

const supportsAbortingBeforeTheFirstChunk = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registration = registerFauxProvider({
        tokenSize: { max: 3, min: 3 },
        tokensPerSecond: 50,
      });
      registrations.push(registration);
      registration.setResponses([fauxAssistantMessage("abcdefghijklmnopqrstuvwxyz")]);

      const controllerSignal = AbortSignal.abort();
      const currentTime10 = yield* Clock.currentTimeMillis;
      const events = yield* Effect.promise(() =>
        collectEvents(
          stream(
            registration.getModel(),
            { messages: [{ content: "hi", role: "user", timestamp: currentTime10 }] },
            { signal: controllerSignal },
          ),
        ),
      );

      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("error");
      if (events[0]?.type === "error") {
        expect(events[0].reason).toBe("aborted");
        expect(events[0].error.stopReason).toBe("aborted");
      }
    }),
  );

const supportsAbortingMidTextStreamWhen = () => {
  const controller = new AbortController();
  return Effect.runPromise(
    Effect.gen(function* () {
      const registration = registerFauxProvider({
        tokenSize: { max: 3, min: 3 },
        tokensPerSecond: 100,
      });
      registrations.push(registration);
      registration.setResponses([fauxAssistantMessage("abcdefghijklmnopqrstuvwxyz")]);

      const events: string[] = [];
      const textDeltaCount = { value: 0 };
      const s = stream(
        registration.getModel(),
        {
          messages: [{ content: "hi", role: "user", timestamp: yield* Clock.currentTimeMillis }],
        },
        { signal: controller.signal },
      );
      yield* Stream.fromAsyncIterable(s, (error) => error).pipe(
        Stream.orDie,
        Stream.runForEach((event) =>
          Effect.sync(() => {
            events.push(event.type);
            if (event.type === "text_delta") {
              textDeltaCount.value++;
              controller.abort();
            }
          }),
        ),
      );

      expect(textDeltaCount.value).toBe(1);
      expect(events).toContain("text_start");
      expect(events).toContain("text_delta");
      expect(events).toContain("error");
      expect(events).not.toContain("text_end");
    }),
  );
};

const supportsAbortingMidThinkingStreamWhen = () => {
  const controller = new AbortController();
  return Effect.runPromise(
    Effect.gen(function* () {
      const registration = registerFauxProvider({
        tokenSize: { max: 3, min: 3 },
        tokensPerSecond: 100,
      });
      registrations.push(registration);
      registration.setResponses([
        {
          ...fauxAssistantMessage("ignored"),
          content: [{ thinking: "abcdefghijklmnopqrstuvwxyz", type: "thinking" }],
        },
      ]);

      const events: string[] = [];
      const thinkingDeltaCount = { value: 0 };
      const s = stream(
        registration.getModel(),
        {
          messages: [{ content: "hi", role: "user", timestamp: yield* Clock.currentTimeMillis }],
        },
        { signal: controller.signal },
      );
      yield* Stream.fromAsyncIterable(s, (error) => error).pipe(
        Stream.orDie,
        Stream.runForEach((event) =>
          Effect.sync(() => {
            events.push(event.type);
            if (event.type === "thinking_delta") {
              thinkingDeltaCount.value++;
              controller.abort();
            }
          }),
        ),
      );

      expect(thinkingDeltaCount.value).toBe(1);
      expect(events).toContain("thinking_start");
      expect(events).toContain("thinking_delta");
      expect(events).toContain("error");
      expect(events).not.toContain("thinking_end");
    }),
  );
};

describe("faux provider", () => {
  it(
    "streams an explicit assistant aborted message as a terminal error",
    streamsAnExplicitAssistantAbortedMessage,
  );
});

describe("faux provider", () => {
  it("supports aborting before the first chunk", supportsAbortingBeforeTheFirstChunk);
});

describe("faux provider", () => {
  it("supports aborting mid-text stream when paced", supportsAbortingMidTextStreamWhen);
});

describe("faux provider", () => {
  it("supports aborting mid-thinking stream when paced", supportsAbortingMidThinkingStreamWhen);
});
