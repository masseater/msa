import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { stream as streamAnthropic } from "../src/api/anthropic-messages.ts";
import { normalizeContext } from "../src/compat.ts";
import type { Model } from "../src/types.ts";
import anthropicSseParsingSupport from "./anthropic-sse-parsing-support.ts";
import modelChoice from "./model-choice.ts";

const { createFakeAnthropicClient, createResponseModelSseResponse, createSseResponse } =
  anthropicSseParsingSupport;
const { chooseModel, usesApi } = modelChoice;

const servedModel = chooseModel("anthropic-api", "Messages", usesApi("anthropic-messages"));
const fallbackModel = "fallback-model";
const hello = normalizeContext({ messages: [{ content: "Hello", role: "user", timestamp: 1 }] });

const usesFallbackModelForCost = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model: Model<"anthropic-messages"> = {
        ...servedModel,
        compat: {
          allowedFallbackModels: [
            {
              cost: { cacheRead: 0, cacheWrite: 0, input: 3, output: 5 },
              model: fallbackModel,
              provider: "anthropic-api",
            },
          ],
        },
      };
      const response = createResponseModelSseResponse(fallbackModel, {
        text: "done",
        type: "text",
      });
      const result = yield* Effect.promise(() =>
        streamAnthropic(model, hello, { client: createFakeAnthropicClient(response) }).result(),
      );

      expect(result.model).toBe(model.id);
      expect(result.responseModel).toBe(fallbackModel);
      expect(result.usage.cost.input).toBeCloseTo(0.0003, 10);
      expect(result.usage.cost.output).toBeCloseTo(0.0001, 10);
    }),
  );

const midOutputFallbackResponse = () =>
  createSseResponse([
    {
      data: {
        message: {
          id: "msg_fallback",
          model: servedModel.id,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
        type: "message_start",
      },
      event: "message_start",
    },
    {
      data: {
        content_block: { text: "partial", type: "text" },
        index: 0,
        type: "content_block_start",
      },
      event: "content_block_start",
    },
    { data: { index: 0, type: "content_block_stop" }, event: "content_block_stop" },
    {
      data: {
        content_block: {
          from: { model: servedModel.id },
          to: { model: fallbackModel },
          type: "fallback",
        },
        index: 1,
        type: "content_block_start",
      },
      event: "content_block_start",
    },
  ]);

const failsOnMidOutputFallback = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* Effect.promise(() =>
        streamAnthropic(servedModel, hello, {
          client: createFakeAnthropicClient(midOutputFallbackResponse()),
        }).result(),
      );
      expect(result.stopReason).toBe("error");
      expect(result.errorMessage).toContain("unsupported mid-output model fallback");
    }),
  );

describe("Anthropic raw SSE parsing", () => {
  it("uses a returned fallback model for cost attribution", usesFallbackModelForCost);
  it("fails safely when Anthropic falls back after output begins", failsOnMidOutputFallback);
});
