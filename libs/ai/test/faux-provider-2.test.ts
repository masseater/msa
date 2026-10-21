import { Clock, Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import compat from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";
import fauxProviderSupport from "./faux-provider-support.ts";
import jsonCodec from "./json-codec.ts";

const { Type, complete, fauxAssistantMessage, registerFauxProvider, stream } = compat;

const { collectEvents, registrations } = fauxProviderSupport;

afterEach(() => {
  for (const registration of registrations.splice(0)) {
    registration.unregister();
  }
});

const { encodeJson } = jsonCodec;

const supportsAsyncResponseFactories = () =>
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
          messages: [{ content: "hi", role: "user", timestamp: currentTime3 }],
        }),
      );

      expect(response.content).toEqual([{ text: "1:1", type: "text" }]);
    }),
  );

const emitsAnErrorWhenAResponse = () =>
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
            messages: [{ content: "hi", role: "user", timestamp: currentTime4 }],
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
  );

const rejectsAQueuedResponseWithoutA = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registration = registerFauxProvider();
      registrations.push(registration);
      registration.setResponses([fauxAssistantMessage("partial", { stopReason: "pending" })]);

      const currentTime5 = yield* Clock.currentTimeMillis;
      const events = yield* Effect.promise(() =>
        collectEvents(
          stream(registration.getModel(), {
            messages: [{ content: "hi", role: "user", timestamp: currentTime5 }],
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
  );

const estimatesPromptAndOutputTokensFrom = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { response, expectedPromptTokens } = yield* estimatesPromptAndOutputTokensFromStep1();
      const expectedOutputTokens = Math.ceil("done".length / 4);

      expect(response.usage.input).toBe(expectedPromptTokens);
      expect(response.usage.output).toBe(expectedOutputTokens);
      expect(response.usage.cacheRead).toBe(0);
      expect(response.usage.cacheWrite).toBe(0);
      expect(response.usage.totalTokens).toBe(expectedPromptTokens + expectedOutputTokens);
    }),
  );

const estimatesPromptAndOutputTokensFromStep1 = () =>
  Effect.gen(function* () {
    const registration = registerFauxProvider();
    registrations.push(registration);
    registration.setResponses([fauxAssistantMessage("done")]);

    const tool = {
      description: "Echo back text",
      name: "echo",
      parameters: Type.Object({ text: Type.String() }),
    };
    const context: typesModule.Context = {
      messages: [
        {
          content: [
            { text: "hello", type: "text" },
            { data: "abcd", mimeType: "image/png", type: "image" },
          ],
          role: "user",
          timestamp: 1,
        },
        fauxAssistantMessage("prior"),
        {
          content: [{ text: "tool out", type: "text" }],
          isError: false,
          role: "toolResult",
          timestamp: 2,
          toolCallId: "tool-1",
          toolName: "echo",
        },
      ],
      systemPrompt: "sys",
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
    return { expectedPromptTokens, response };
  });

describe("faux provider", () => {
  it("supports async response factories", supportsAsyncResponseFactories);
});

describe("faux provider", () => {
  it("emits an error when a response factory throws", emitsAnErrorWhenAResponse);
});

describe("faux provider", () => {
  it("rejects a queued response without a terminal stop reason", rejectsAQueuedResponseWithoutA);
});

describe("faux provider", () => {
  it(
    "estimates prompt and output tokens from serialized context",
    estimatesPromptAndOutputTokensFrom,
  );
});
