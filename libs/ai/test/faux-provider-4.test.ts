import { Clock, Effect, Stream } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import compat from "../src/compat.ts";
import fauxProviderSupport from "./faux-provider-support.ts";
import jsonCodec from "./json-codec.ts";

const { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall, registerFauxProvider, stream } =
  compat;

const { collectEvents, registrations } = fauxProviderSupport;

afterEach(() => {
  for (const registration of registrations.splice(0)) {
    registration.unregister();
  }
});

const { decodeJson } = jsonCodec;

const streamsThinkingTextAndPartialTool = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registration = registerFauxProvider();
      registrations.push(registration);
      registration.setResponses([
        fauxAssistantMessage(
          [
            fauxThinking("thinking text"),
            fauxText("answer text"),
            fauxToolCall("echo", { count: 12, text: "hi" }, { id: "tool-1" }),
          ],
          { stopReason: "toolUse" },
        ),
      ]);

      const events: string[] = [];
      const toolCallDeltas: string[] = [];
      const s = stream(registration.getModel(), {
        messages: [{ content: "hi", role: "user", timestamp: yield* Clock.currentTimeMillis }],
      });
      yield* Stream.fromAsyncIterable(s, (error) => error).pipe(
        Stream.orDie,
        Stream.runForEach((event) =>
          Effect.sync(() => {
            events.push(event.type);
            if (event.type === "toolcall_delta") {
              toolCallDeltas.push(event.delta);
            }
          }),
        ),
      );

      expect(events).toContain("thinking_start");
      expect(events).toContain("thinking_delta");
      expect(events).toContain("text_start");
      expect(events).toContain("text_delta");
      expect(events).toContain("toolcall_start");
      expect(events).toContain("toolcall_delta");
      expect(events).toContain("toolcall_end");
      expect(toolCallDeltas.length).toBeGreaterThan(1);
      expect(yield* decodeJson(toolCallDeltas.join(""))).toEqual({ count: 12, text: "hi" });
    }),
  );

const streamsAnExactEventOrderFor = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registration = registerFauxProvider({ tokenSize: { max: 1, min: 1 } });
      registrations.push(registration);
      registration.setResponses([
        fauxAssistantMessage(
          [fauxThinking("go"), fauxText("ok"), fauxToolCall("echo", {}, { id: "tool-1" })],
          {
            stopReason: "toolUse",
          },
        ),
      ]);

      const currentTime6 = yield* Clock.currentTimeMillis;
      const events = yield* Effect.promise(() =>
        collectEvents(
          stream(registration.getModel(), {
            messages: [{ content: "hi", role: "user", timestamp: currentTime6 }],
          }),
        ),
      );

      expect(events[0]).toMatchObject({ partial: { stopReason: "pending" }, type: "start" });
      expect(events.map((event) => event.type)).toEqual([
        "start",
        "thinking_start",
        "thinking_delta",
        "thinking_end",
        "text_start",
        "text_delta",
        "text_end",
        "toolcall_start",
        "toolcall_delta",
        "toolcall_end",
        "done",
      ]);
    }),
  );

const streamsMultipleToolCallsInOne = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registration = registerFauxProvider();
      registrations.push(registration);
      registration.setResponses([
        fauxAssistantMessage(
          [
            fauxToolCall("echo", { text: "one" }, { id: "tool-1" }),
            fauxToolCall("echo", { text: "two" }, { id: "tool-2" }),
          ],
          { stopReason: "toolUse" },
        ),
      ]);

      const currentTime7 = yield* Clock.currentTimeMillis;
      const events = yield* Effect.promise(() =>
        collectEvents(
          stream(registration.getModel(), {
            messages: [{ content: "hi", role: "user", timestamp: currentTime7 }],
          }),
        ),
      );

      expect(events.filter((event) => event.type === "toolcall_start")).toHaveLength(2);
      expect(events.filter((event) => event.type === "toolcall_end")).toHaveLength(2);
    }),
  );

const streamsAnExplicitAssistantErrorMessage = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registration = registerFauxProvider({ tokenSize: { max: 2, min: 2 } });
      registrations.push(registration);
      registration.setResponses([
        {
          ...fauxAssistantMessage("partial"),
          errorMessage: "upstream failed",
          stopReason: "error",
        },
      ]);

      const currentTime8 = yield* Clock.currentTimeMillis;
      const events = yield* Effect.promise(() =>
        collectEvents(
          stream(registration.getModel(), {
            messages: [{ content: "hi", role: "user", timestamp: currentTime8 }],
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
        expect(terminal.reason).toBe("error");
        expect(terminal.error.stopReason).toBe("error");
        expect(terminal.error.errorMessage).toBe("upstream failed");
      }
    }),
  );

describe("faux provider", () => {
  it("streams thinking, text, and partial tool call deltas", streamsThinkingTextAndPartialTool);
});

describe("faux provider", () => {
  it("streams an exact event order for fixed-size chunks", streamsAnExactEventOrderFor);
});

describe("faux provider", () => {
  it("streams multiple tool calls in one message", streamsMultipleToolCallsInOne);
});

describe("faux provider", () => {
  it(
    "streams an explicit assistant error message as a terminal error",
    streamsAnExplicitAssistantErrorMessage,
  );
});
