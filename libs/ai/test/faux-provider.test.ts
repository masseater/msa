import { Clock, Effect, Stream } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  complete,
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
  registerFauxProvider,
  stream,
  Type,
} from "../src/compat.ts";
import type { AssistantMessageEvent, Context } from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import { decodeJson, encodeJson } from "./json-codec.ts";

function collectEvents(streamResult: ReturnType<typeof stream>): Promise<AssistantMessageEvent[]> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const events: AssistantMessageEvent[] = [];
      yield* Stream.fromAsyncIterable(streamResult, (error) => error).pipe(
        Stream.orDie,
        Stream.runForEach((event) =>
          Effect.sync(() => {
            events.push(event);
          }),
        ),
      );
      return events;
    }),
  );
}

const registrations: Array<{ unregister: () => void }> = [];

afterEach(() => {
  for (const registration of registrations.splice(0)) {
    registration.unregister();
  }
});

describe("faux provider", () => {
  it("registers a custom provider and estimates usage", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const registration = registerFauxProvider();
        registrations.push(registration);
        registration.setResponses([fauxAssistantMessage("hello world")]);

        const context: Context = {
          systemPrompt: "Be concise.",
          messages: [
            { role: "user", content: "hi there", timestamp: yield* Clock.currentTimeMillis },
          ],
        };

        const response = yield* Effect.promise(() => complete(registration.getModel(), context));
        expect(response.content).toEqual([{ type: "text", text: "hello world" }]);
        expect(response.usage.input).toBeGreaterThan(0);
        expect(response.usage.output).toBeGreaterThan(0);
        expect(response.usage.totalTokens).toBe(response.usage.input + response.usage.output);
        expect(registration.state.callCount).toBe(1);
      }),
    ));

  it("supports helper blocks for text, thinking, and tool calls", async () => {
    const registration = registerFauxProvider();
    registrations.push(registration);
    registration.setResponses([
      fauxAssistantMessage(
        [fauxThinking("think"), fauxToolCall("echo", { text: "hi" }), fauxText("done")],
        {
          stopReason: "toolUse",
        },
      ),
    ]);

    const response = await complete(registration.getModel(), {
      messages: [{ role: "user", content: "hi", timestamp: currentTimeMillis() }],
    });

    expect(response.content).toEqual([
      { type: "thinking", thinking: "think" },
      { type: "toolCall", id: expect.any(String), name: "echo", arguments: { text: "hi" } },
      { type: "text", text: "done" },
    ]);
    expect(response.stopReason).toBe("toolUse");
  });

  it("supports multiple models with per-model reasoning and model-aware factories", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const registration = registerFauxProvider({
          models: [
            { id: "faux-fast", name: "Faux Fast", reasoning: false },
            { id: "faux-thinker", name: "Faux Thinker", reasoning: true },
          ],
        });
        registrations.push(registration);
        registration.setResponses([
          (_context, _options, _state, model) =>
            fauxAssistantMessage(`${model.id}:${String(model.reasoning)}`),
          (_context, _options, _state, model) =>
            fauxAssistantMessage(`${model.id}:${String(model.reasoning)}`),
        ]);

        expect(registration.models.map((model) => model.id)).toEqual(["faux-fast", "faux-thinker"]);
        expect(registration.getModel()).toBe(registration.models[0]);
        expect(registration.getModel("faux-fast")?.reasoning).toBe(false);
        expect(registration.getModel("faux-thinker")?.reasoning).toBe(true);

        const currentTime = yield* Clock.currentTimeMillis;
        const fast = yield* Effect.promise(() =>
          complete(registration.getModel("faux-fast")!, {
            messages: [{ role: "user", content: "hi", timestamp: currentTime }],
          }),
        );
        const currentTime1 = yield* Clock.currentTimeMillis;
        const thinker = yield* Effect.promise(() =>
          complete(registration.getModel("faux-thinker")!, {
            messages: [{ role: "user", content: "hi", timestamp: currentTime1 }],
          }),
        );

        expect(fast.content).toEqual([{ type: "text", text: "faux-fast:false" }]);
        expect(thinker.content).toEqual([{ type: "text", text: "faux-thinker:true" }]);
      }),
    ));

  it("rewrites api, provider, and model on returned messages", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const registration = registerFauxProvider({
          api: "faux:test",
          provider: "faux-provider",
          models: [{ id: "faux-model" }],
        });
        registrations.push(registration);
        registration.setResponses([fauxAssistantMessage("hello")]);

        const currentTime2 = yield* Clock.currentTimeMillis;
        const response = yield* Effect.promise(() =>
          complete(registration.getModel(), {
            messages: [{ role: "user", content: "hi", timestamp: currentTime2 }],
          }),
        );

        expect(response.api).toBe("faux:test");
        expect(response.provider).toBe("faux-provider");
        expect(response.model).toBe("faux-model");
      }),
    ));

  it("consumes queued responses in order and errors when exhausted", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const registration = registerFauxProvider();
        registrations.push(registration);
        registration.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);

        const context: Context = {
          messages: [{ role: "user", content: "hi", timestamp: yield* Clock.currentTimeMillis }],
        };

        const first = yield* Effect.promise(() => complete(registration.getModel(), context));
        const second = yield* Effect.promise(() => complete(registration.getModel(), context));
        const exhausted = yield* Effect.promise(() => complete(registration.getModel(), context));

        expect(first.content).toEqual([{ type: "text", text: "first" }]);
        expect(second.content).toEqual([{ type: "text", text: "second" }]);
        expect(exhausted.stopReason).toBe("error");
        expect(exhausted.errorMessage).toBe("No more faux responses queued");
        expect(registration.getPendingResponseCount()).toBe(0);
        expect(registration.state.callCount).toBe(3);
      }),
    ));

  it("can replace and append queued responses", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const registration = registerFauxProvider();
        registrations.push(registration);
        registration.setResponses([fauxAssistantMessage("first")]);

        const context: Context = {
          messages: [{ role: "user", content: "hi", timestamp: yield* Clock.currentTimeMillis }],
        };

        expect(
          (yield* Effect.promise(() => complete(registration.getModel(), context))).content,
        ).toEqual([{ type: "text", text: "first" }]);
        expect(registration.getPendingResponseCount()).toBe(0);

        registration.setResponses([fauxAssistantMessage("second")]);
        expect(registration.getPendingResponseCount()).toBe(1);
        expect(
          (yield* Effect.promise(() => complete(registration.getModel(), context))).content,
        ).toEqual([{ type: "text", text: "second" }]);

        registration.appendResponses([
          fauxAssistantMessage("third"),
          fauxAssistantMessage("fourth"),
        ]);
        expect(registration.getPendingResponseCount()).toBe(2);
        expect(
          (yield* Effect.promise(() => complete(registration.getModel(), context))).content,
        ).toEqual([{ type: "text", text: "third" }]);
        expect(
          (yield* Effect.promise(() => complete(registration.getModel(), context))).content,
        ).toEqual([{ type: "text", text: "fourth" }]);
        expect(registration.getPendingResponseCount()).toBe(0);
      }),
    ));

  it("supports async response factories", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const registration = registerFauxProvider();
        registrations.push(registration);
        registration.setResponses([
          (context, _options, state) =>
            Promise.resolve(fauxAssistantMessage(`${context.messages.length}:${state.callCount}`)),
        ]);

        const currentTime3 = yield* Clock.currentTimeMillis;
        const response = yield* Effect.promise(() =>
          complete(registration.getModel(), {
            messages: [{ role: "user", content: "hi", timestamp: currentTime3 }],
          }),
        );

        expect(response.content).toEqual([{ type: "text", text: "1:1" }]);
      }),
    ));

  it("emits an error when a response factory throws", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const registration = registerFauxProvider();
        registrations.push(registration);
        registration.setResponses([
          () => {
            throw new Error("boom");
          },
        ]);

        const currentTime4 = yield* Clock.currentTimeMillis;
        const events = yield* Effect.promise(() =>
          collectEvents(
            stream(registration.getModel(), {
              messages: [{ role: "user", content: "hi", timestamp: currentTime4 }],
            }),
          ),
        );

        expect(events).toHaveLength(1);
        expect(events[0]?.type).toBe("error");
        if (events[0]?.type === "error") {
          expect(events[0].error.stopReason).toBe("error");
          expect(events[0].error.errorMessage).toBe("boom");
        }
      }),
    ));

  it("rejects a queued response without a terminal stop reason", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const registration = registerFauxProvider();
        registrations.push(registration);
        registration.setResponses([fauxAssistantMessage("partial", { stopReason: "pending" })]);

        const currentTime5 = yield* Clock.currentTimeMillis;
        const events = yield* Effect.promise(() =>
          collectEvents(
            stream(registration.getModel(), {
              messages: [{ role: "user", content: "hi", timestamp: currentTime5 }],
            }),
          ),
        );

        expect(events.some((event) => event.type === "done")).toBe(false);
        const terminal = events.at(-1);
        expect(terminal?.type).toBe("error");
        if (terminal?.type === "error") {
          expect(terminal.error.stopReason).toBe("error");
          expect(terminal.error.errorMessage).toBe("Faux response ended without a stop reason");
        }
      }),
    ));

  it("estimates prompt and output tokens from serialized context", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const registration = registerFauxProvider();
        registrations.push(registration);
        registration.setResponses([fauxAssistantMessage("done")]);

        const tool = {
          name: "echo",
          description: "Echo back text",
          parameters: Type.Object({ text: Type.String() }),
        };
        const context: Context = {
          systemPrompt: "sys",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "hello" },
                { type: "image", mimeType: "image/png", data: "abcd" },
              ],
              timestamp: 1,
            },
            fauxAssistantMessage("prior"),
            {
              role: "toolResult",
              toolCallId: "tool-1",
              toolName: "echo",
              content: [{ type: "text", text: "tool out" }],
              isError: false,
              timestamp: 2,
            },
          ],
          tools: [tool],
        };

        const response = yield* Effect.promise(() => complete(registration.getModel(), context));
        const promptText = [
          "system:sys",
          "user:hello\n[image:image/png:4]",
          "assistant:prior",
          "toolResult:echo\ntool out",
          `tools:${yield* encodeJson([tool])}`,
        ].join("\n\n");
        const expectedPromptTokens = Math.ceil(promptText.length / 4);
        const expectedOutputTokens = Math.ceil("done".length / 4);

        expect(response.usage.input).toBe(expectedPromptTokens);
        expect(response.usage.output).toBe(expectedOutputTokens);
        expect(response.usage.cacheRead).toBe(0);
        expect(response.usage.cacheWrite).toBe(0);
        expect(response.usage.totalTokens).toBe(expectedPromptTokens + expectedOutputTokens);
      }),
    ));

  it("does not share cache across sessions or requests without sessionId", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const registration = registerFauxProvider();
        registrations.push(registration);
        registration.setResponses([
          fauxAssistantMessage("first"),
          fauxAssistantMessage("second"),
          fauxAssistantMessage("third"),
        ]);

        const context: Context = {
          messages: [{ role: "user", content: "hello", timestamp: yield* Clock.currentTimeMillis }],
        };

        const first = yield* Effect.promise(() =>
          complete(registration.getModel(), context, {
            sessionId: "session-1",
            cacheRetention: "short",
          }),
        );
        expect(first.usage.cacheWrite).toBeGreaterThan(0);
        context.messages.push(first);
        context.messages.push({
          role: "user",
          content: "follow up",
          timestamp: (yield* Clock.currentTimeMillis) + 1,
        });

        const second = yield* Effect.promise(() =>
          complete(registration.getModel(), context, {
            sessionId: "session-2",
            cacheRetention: "short",
          }),
        );
        expect(second.usage.cacheRead).toBe(0);
        expect(second.usage.cacheWrite).toBeGreaterThan(0);

        const third = yield* Effect.promise(() => complete(registration.getModel(), context));
        expect(third.usage.cacheRead).toBe(0);
        expect(third.usage.cacheWrite).toBe(0);
      }),
    ));

  it("simulates prompt caching per sessionId", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const registration = registerFauxProvider();
        registrations.push(registration);
        registration.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);

        const context: Context = {
          systemPrompt: "Be concise.",
          messages: [{ role: "user", content: "hello", timestamp: yield* Clock.currentTimeMillis }],
        };

        const first = yield* Effect.promise(() =>
          complete(registration.getModel(), context, {
            sessionId: "session-1",
            cacheRetention: "short",
          }),
        );
        expect(first.usage.cacheRead).toBe(0);
        expect(first.usage.cacheWrite).toBeGreaterThan(0);

        context.messages.push(first);
        context.messages.push({
          role: "user",
          content: "follow up",
          timestamp: (yield* Clock.currentTimeMillis) + 1,
        });

        const second = yield* Effect.promise(() =>
          complete(registration.getModel(), context, {
            sessionId: "session-1",
            cacheRetention: "short",
          }),
        );
        expect(second.usage.cacheRead).toBeGreaterThan(0);
        expect(second.usage.input + second.usage.cacheRead).toBeGreaterThan(second.usage.input);
      }),
    ));

  it("counts cached characters up to the first difference in the joined prompt", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const registration = registerFauxProvider();
        registrations.push(registration);
        registration.setResponses([
          fauxAssistantMessage("a"),
          fauxAssistantMessage("b"),
          fauxAssistantMessage("c"),
        ]);
        const options = { sessionId: "session-1", cacheRetention: "short" } as const;
        const user = (content: string) => ({ role: "user" as const, content, timestamp: 1 });

        yield* Effect.promise(() =>
          complete(registration.getModel(), { messages: [user("hello world")] }, options),
        );
        const extended = yield* Effect.promise(() =>
          complete(
            registration.getModel(),
            { messages: [user("hello world"), user("next")] },
            options,
          ),
        );
        expect(extended.usage).toMatchObject({ input: 3, cacheRead: 4, cacheWrite: 3 });

        const edited = yield* Effect.promise(() =>
          complete(
            registration.getModel(),
            { messages: [user("hello wide"), user("next")] },
            options,
          ),
        );
        expect(edited.usage).toMatchObject({ input: 4, cacheRead: 3, cacheWrite: 4 });
      }),
    ));

  it("does not simulate caching when cacheRetention is none", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const registration = registerFauxProvider();
        registrations.push(registration);
        registration.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);

        const context: Context = {
          messages: [{ role: "user", content: "hello", timestamp: yield* Clock.currentTimeMillis }],
        };

        yield* Effect.promise(() =>
          complete(registration.getModel(), context, {
            sessionId: "session-1",
            cacheRetention: "none",
          }),
        );
        context.messages.push(fauxAssistantMessage("first"));
        context.messages.push({
          role: "user",
          content: "follow up",
          timestamp: (yield* Clock.currentTimeMillis) + 1,
        });
        const second = yield* Effect.promise(() =>
          complete(registration.getModel(), context, {
            sessionId: "session-1",
            cacheRetention: "none",
          }),
        );
        expect(second.usage.cacheRead).toBe(0);
        expect(second.usage.cacheWrite).toBe(0);
      }),
    ));

  it("streams thinking, text, and partial tool call deltas", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const registration = registerFauxProvider();
        registrations.push(registration);
        registration.setResponses([
          fauxAssistantMessage(
            [
              fauxThinking("thinking text"),
              fauxText("answer text"),
              fauxToolCall("echo", { text: "hi", count: 12 }, { id: "tool-1" }),
            ],
            { stopReason: "toolUse" },
          ),
        ]);

        const events: string[] = [];
        const toolCallDeltas: string[] = [];
        const s = stream(registration.getModel(), {
          messages: [{ role: "user", content: "hi", timestamp: yield* Clock.currentTimeMillis }],
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
        expect(yield* decodeJson(toolCallDeltas.join(""))).toEqual({ text: "hi", count: 12 });
      }),
    ));

  it("streams an exact event order for fixed-size chunks", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const registration = registerFauxProvider({ tokenSize: { min: 1, max: 1 } });
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
              messages: [{ role: "user", content: "hi", timestamp: currentTime6 }],
            }),
          ),
        );

        expect(events[0]).toMatchObject({ type: "start", partial: { stopReason: "pending" } });
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
    ));

  it("streams multiple tool calls in one message", () =>
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
              messages: [{ role: "user", content: "hi", timestamp: currentTime7 }],
            }),
          ),
        );

        expect(events.filter((event) => event.type === "toolcall_start")).toHaveLength(2);
        expect(events.filter((event) => event.type === "toolcall_end")).toHaveLength(2);
      }),
    ));

  it("streams an explicit assistant error message as a terminal error", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const registration = registerFauxProvider({ tokenSize: { min: 2, max: 2 } });
        registrations.push(registration);
        registration.setResponses([
          {
            ...fauxAssistantMessage("partial"),
            stopReason: "error",
            errorMessage: "upstream failed",
          },
        ]);

        const currentTime8 = yield* Clock.currentTimeMillis;
        const events = yield* Effect.promise(() =>
          collectEvents(
            stream(registration.getModel(), {
              messages: [{ role: "user", content: "hi", timestamp: currentTime8 }],
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
        const terminal = events[events.length - 1];
        expect(terminal?.type).toBe("error");
        if (terminal?.type === "error") {
          expect(terminal.reason).toBe("error");
          expect(terminal.error.stopReason).toBe("error");
          expect(terminal.error.errorMessage).toBe("upstream failed");
        }
      }),
    ));

  it("streams an explicit assistant aborted message as a terminal error", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const registration = registerFauxProvider({ tokenSize: { min: 2, max: 2 } });
        registrations.push(registration);
        registration.setResponses([
          {
            ...fauxAssistantMessage("partial"),
            stopReason: "aborted",
            errorMessage: "Request was aborted",
          },
        ]);

        const currentTime9 = yield* Clock.currentTimeMillis;
        const events = yield* Effect.promise(() =>
          collectEvents(
            stream(registration.getModel(), {
              messages: [{ role: "user", content: "hi", timestamp: currentTime9 }],
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
        const terminal = events[events.length - 1];
        expect(terminal?.type).toBe("error");
        if (terminal?.type === "error") {
          expect(terminal.reason).toBe("aborted");
          expect(terminal.error.stopReason).toBe("aborted");
          expect(terminal.error.errorMessage).toBe("Request was aborted");
        }
      }),
    ));

  it("supports aborting before the first chunk", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const registration = registerFauxProvider({
          tokensPerSecond: 50,
          tokenSize: { min: 3, max: 3 },
        });
        registrations.push(registration);
        registration.setResponses([fauxAssistantMessage("abcdefghijklmnopqrstuvwxyz")]);

        const controllerSignal = AbortSignal.abort();
        const currentTime10 = yield* Clock.currentTimeMillis;
        const events = yield* Effect.promise(() =>
          collectEvents(
            stream(
              registration.getModel(),
              { messages: [{ role: "user", content: "hi", timestamp: currentTime10 }] },
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
    ));

  it("supports aborting mid-text stream when paced", () => {
    const controller = new AbortController();
    return Effect.runPromise(
      Effect.gen(function* () {
        const registration = registerFauxProvider({
          tokensPerSecond: 100,
          tokenSize: { min: 3, max: 3 },
        });
        registrations.push(registration);
        registration.setResponses([fauxAssistantMessage("abcdefghijklmnopqrstuvwxyz")]);

        const events: string[] = [];
        let textDeltaCount = 0;
        const s = stream(
          registration.getModel(),
          {
            messages: [{ role: "user", content: "hi", timestamp: yield* Clock.currentTimeMillis }],
          },
          { signal: controller.signal },
        );
        yield* Stream.fromAsyncIterable(s, (error) => error).pipe(
          Stream.orDie,
          Stream.runForEach((event) =>
            Effect.sync(() => {
              events.push(event.type);
              if (event.type === "text_delta") {
                textDeltaCount++;
                controller.abort();
              }
            }),
          ),
        );

        expect(textDeltaCount).toBe(1);
        expect(events).toContain("text_start");
        expect(events).toContain("text_delta");
        expect(events).toContain("error");
        expect(events).not.toContain("text_end");
      }),
    );
  });

  it("supports aborting mid-thinking stream when paced", () => {
    const controller = new AbortController();
    return Effect.runPromise(
      Effect.gen(function* () {
        const registration = registerFauxProvider({
          tokensPerSecond: 100,
          tokenSize: { min: 3, max: 3 },
        });
        registrations.push(registration);
        registration.setResponses([
          {
            ...fauxAssistantMessage("ignored"),
            content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }],
          },
        ]);

        const events: string[] = [];
        let thinkingDeltaCount = 0;
        const s = stream(
          registration.getModel(),
          {
            messages: [{ role: "user", content: "hi", timestamp: yield* Clock.currentTimeMillis }],
          },
          { signal: controller.signal },
        );
        yield* Stream.fromAsyncIterable(s, (error) => error).pipe(
          Stream.orDie,
          Stream.runForEach((event) =>
            Effect.sync(() => {
              events.push(event.type);
              if (event.type === "thinking_delta") {
                thinkingDeltaCount++;
                controller.abort();
              }
            }),
          ),
        );

        expect(thinkingDeltaCount).toBe(1);
        expect(events).toContain("thinking_start");
        expect(events).toContain("thinking_delta");
        expect(events).toContain("error");
        expect(events).not.toContain("thinking_end");
      }),
    );
  });

  it("supports aborting mid-toolcall stream when paced", async () => {
    const registration = registerFauxProvider({
      tokensPerSecond: 100,
      tokenSize: { min: 3, max: 3 },
    });
    registrations.push(registration);
    registration.setResponses([
      {
        ...fauxAssistantMessage("done"),
        content: [
          {
            type: "toolCall",
            id: "tool-1",
            name: "echo",
            arguments: { text: "abcdefghijklmnopqrstuvwxyz", count: 123456789 },
          },
        ],
        stopReason: "toolUse",
      },
    ]);

    const controller = new AbortController();
    const events: string[] = [];
    let toolCallDeltaCount = 0;
    const s = stream(
      registration.getModel(),
      { messages: [{ role: "user", content: "hi", timestamp: currentTimeMillis() }] },
      { signal: controller.signal },
    );
    await Effect.runPromise(
      Stream.fromAsyncIterable(s, (error) => error).pipe(
        Stream.orDie,
        Stream.runForEach((event) =>
          Effect.sync(() => {
            events.push(event.type);
            if (event.type === "toolcall_delta") {
              toolCallDeltaCount++;
              controller.abort();
            }
          }),
        ),
      ),
    );

    expect(toolCallDeltaCount).toBe(1);
    expect(events).toContain("toolcall_start");
    expect(events).toContain("toolcall_delta");
    expect(events).toContain("error");
    expect(events).not.toContain("toolcall_end");
  });

  it("unregisters the provider", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const registration = registerFauxProvider();
        registration.setResponses([fauxAssistantMessage("hello")]);
        registration.unregister();

        const currentTime11 = yield* Clock.currentTimeMillis;
        yield* Effect.promise(() =>
          expect(
            complete(registration.getModel(), {
              messages: [{ role: "user", content: "hi", timestamp: currentTime11 }],
            }),
          ).rejects.toThrow(`No API provider registered for api: ${registration.api}`),
        );
      }),
    ));
});
