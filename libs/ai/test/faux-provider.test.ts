import { Clock, Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  complete,
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
  registerFauxProvider,
} from "../src/compat.ts";
import type { Context } from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import fauxProviderSupport from "./faux-provider-support.ts";

const { registrations } = fauxProviderSupport;

afterEach(() => {
  for (const registration of registrations.splice(0)) {
    registration.unregister();
  }
});

const registersACustomProviderAndEstimates = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registration = registerFauxProvider();
      registrations.push(registration);
      registration.setResponses([fauxAssistantMessage("hello world")]);

      const context: Context = {
        messages: [
          { content: "hi there", role: "user", timestamp: yield* Clock.currentTimeMillis },
        ],
        systemPrompt: "Be concise.",
      };

      const response = yield* Effect.promise(() => complete(registration.getModel(), context));
      expect(response.content).toEqual([{ text: "hello world", type: "text" }]);
      expect(response.usage.input).toBeGreaterThan(0);
      expect(response.usage.output).toBeGreaterThan(0);
      expect(response.usage.totalTokens).toBe(response.usage.input + response.usage.output);
      expect(registration.state.callCount).toBe(1);
    }),
  );

const supportsHelperBlocksForTextThinking = () =>
  Effect.runPromise(
    Effect.gen(function* () {
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

      const response = yield* Effect.promise(() =>
        complete(registration.getModel(), {
          messages: [{ content: "hi", role: "user", timestamp: currentTimeMillis() }],
        }),
      );

      expect(response.content).toEqual([
        { thinking: "think", type: "thinking" },
        { arguments: { text: "hi" }, id: expect.any(String), name: "echo", type: "toolCall" },
        { text: "done", type: "text" },
      ]);
      expect(response.stopReason).toBe("toolUse");
    }),
  );

const supportsMultipleModelsWithPerModel = () =>
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
          messages: [{ content: "hi", role: "user", timestamp: currentTime }],
        }),
      );
      const currentTime1 = yield* Clock.currentTimeMillis;
      const thinker = yield* Effect.promise(() =>
        complete(registration.getModel("faux-thinker")!, {
          messages: [{ content: "hi", role: "user", timestamp: currentTime1 }],
        }),
      );

      expect(fast.content).toEqual([{ text: "faux-fast:false", type: "text" }]);
      expect(thinker.content).toEqual([{ text: "faux-thinker:true", type: "text" }]);
    }),
  );

const rewritesApiProviderAndModelOn = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registration = registerFauxProvider({
        api: "faux:test",
        models: [{ id: "faux-model" }],
        provider: "faux-provider",
      });
      registrations.push(registration);
      registration.setResponses([fauxAssistantMessage("hello")]);

      const currentTime2 = yield* Clock.currentTimeMillis;
      const response = yield* Effect.promise(() =>
        complete(registration.getModel(), {
          messages: [{ content: "hi", role: "user", timestamp: currentTime2 }],
        }),
      );

      expect(response.api).toBe("faux:test");
      expect(response.provider).toBe("faux-provider");
      expect(response.model).toBe("faux-model");
    }),
  );

const consumesQueuedResponsesInOrderAnd = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registration = registerFauxProvider();
      registrations.push(registration);
      registration.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);

      const context: Context = {
        messages: [{ content: "hi", role: "user", timestamp: yield* Clock.currentTimeMillis }],
      };

      const first = yield* Effect.promise(() => complete(registration.getModel(), context));
      const second = yield* Effect.promise(() => complete(registration.getModel(), context));
      const exhausted = yield* Effect.promise(() => complete(registration.getModel(), context));

      expect(first.content).toEqual([{ text: "first", type: "text" }]);
      expect(second.content).toEqual([{ text: "second", type: "text" }]);
      expect(exhausted.stopReason).toBe("error");
      expect(exhausted.errorMessage).toBe("No more faux responses queued");
      expect(registration.getPendingResponseCount()).toBe(0);
      expect(registration.state.callCount).toBe(3);
    }),
  );

const canReplaceAndAppendQueuedResponses = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registration = registerFauxProvider();
      registrations.push(registration);
      registration.setResponses([fauxAssistantMessage("first")]);

      const context: Context = {
        messages: [{ content: "hi", role: "user", timestamp: yield* Clock.currentTimeMillis }],
      };

      expect(
        (yield* Effect.promise(() => complete(registration.getModel(), context))).content,
      ).toEqual([{ text: "first", type: "text" }]);
      expect(registration.getPendingResponseCount()).toBe(0);

      registration.setResponses([fauxAssistantMessage("second")]);
      expect(registration.getPendingResponseCount()).toBe(1);
      expect(
        (yield* Effect.promise(() => complete(registration.getModel(), context))).content,
      ).toEqual([{ text: "second", type: "text" }]);

      registration.appendResponses([fauxAssistantMessage("third"), fauxAssistantMessage("fourth")]);
      expect(registration.getPendingResponseCount()).toBe(2);
      expect(
        (yield* Effect.promise(() => complete(registration.getModel(), context))).content,
      ).toEqual([{ text: "third", type: "text" }]);
      expect(
        (yield* Effect.promise(() => complete(registration.getModel(), context))).content,
      ).toEqual([{ text: "fourth", type: "text" }]);
      expect(registration.getPendingResponseCount()).toBe(0);
    }),
  );

describe("faux provider", () => {
  it("registers a custom provider and estimates usage", registersACustomProviderAndEstimates);

  it(
    "supports helper blocks for text, thinking, and tool calls",
    supportsHelperBlocksForTextThinking,
  );
});

describe("faux provider", () => {
  it(
    "supports multiple models with per-model reasoning and model-aware factories",
    supportsMultipleModelsWithPerModel,
  );
});

describe("faux provider", () => {
  it("rewrites api, provider, and model on returned messages", rewritesApiProviderAndModelOn);

  it(
    "consumes queued responses in order and errors when exhausted",
    consumesQueuedResponsesInOrderAnd,
  );
});

describe("faux provider", () => {
  it("can replace and append queued responses", canReplaceAndAppendQueuedResponses);
});
