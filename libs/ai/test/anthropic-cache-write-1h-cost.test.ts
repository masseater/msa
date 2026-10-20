import type Anthropic from "@anthropic-ai/sdk";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { stream as streamAnthropic } from "../src/api/anthropic-messages.ts";
import { getModel, normalizeContext } from "../src/compat.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import jsonCodec from "./json-codec.ts";

const { encodeJson } = jsonCodec;

function createSseResponse(events: Array<{ event: string; data: string }>): Response {
  const body = events.map(({ event, data }) => `event: ${event}\ndata: ${data}\n`).join("\n");
  return new Response(body, { headers: { "content-type": "text/event-stream" }, status: 200 });
}

function createFakeAnthropicClient(response: Response): Anthropic {
  return {
    beta: { messages: { create: () => ({ asResponse: () => Promise.resolve(response) }) } },
  } as unknown as Anthropic;
}

function eventsWithCacheCreation(
  cacheCreation: Record<string, number> | undefined,
): Array<{ event: string; data: string }> {
  const startUsage: Record<string, unknown> = eventsWithCacheCreationStep1(cacheCreation);
  return [
    {
      data: JSON.stringify({
        message: { id: "msg_test", usage: startUsage },
        type: "message_start",
      }),
      event: "message_start",
    },
    {
      data: JSON.stringify({
        content_block: { text: "", type: "text" },
        index: 0,
        type: "content_block_start",
      }),
      event: "content_block_start",
    },
    {
      data: JSON.stringify({
        delta: { text: "Hi", type: "text_delta" },
        index: 0,
        type: "content_block_delta",
      }),
      event: "content_block_delta",
    },
    { data: JSON.stringify({ index: 0, type: "content_block_stop" }), event: "content_block_stop" },
    {
      data: JSON.stringify({
        delta: { stop_reason: "end_turn" },
        type: "message_delta",
        usage: {
          cache_creation_input_tokens: 1_000_000,
          cache_read_input_tokens: 0,
          input_tokens: 100,
          output_tokens: 5,
        },
      }),
      event: "message_delta",
    },
    { data: JSON.stringify({ type: "message_stop" }), event: "message_stop" },
  ];
}

const context = normalizeContext({
  messages: [{ content: "hi", role: "user", timestamp: currentTimeMillis() }],
});

const pricesThe1hPortionAt2x = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = getModel("anthropic-api", "claude-opus-4-8");
      const response = createSseResponse(
        eventsWithCacheCreation({
          ephemeral_1h_input_tokens: 400_000,
          ephemeral_5m_input_tokens: 600_000,
        }),
      );
      const result = yield* Effect.promise(() =>
        streamAnthropic(model, context, {
          client: createFakeAnthropicClient(response),
        }).result(),
      );

      expect(result.usage.cacheWrite).toBe(1_000_000);
      expect(result.usage.cacheWrite1h).toBe(400_000);
      expect(result.usage.cost.cacheWrite).toBeCloseTo(7.75, 10);
    }),
  );

describe("Anthropic 1h cache write cost", () => {
  it("prices the 1h portion at 2x input and the rest at the 5m rate", pricesThe1hPortionAt2x);
});

const prices1hCacheWritesReportedOnly = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = getModel("anthropic-api", "claude-haiku-4-5");
      const response = createSseResponse([
        {
          data: yield* encodeJson({
            message: { id: "msg_test", usage: { input_tokens: 0, output_tokens: 0 } },
            type: "message_start",
          }),
          event: "message_start",
        },
        {
          data: yield* encodeJson({
            delta: { stop_reason: "end_turn" },
            type: "message_delta",
            usage: {
              cache_creation: { ephemeral_1h_input_tokens: 6535, ephemeral_5m_input_tokens: 0 },
              cache_creation_input_tokens: 6535,
              input_tokens: 3,
              output_tokens: 4,
            },
          }),
          event: "message_delta",
        },
        { data: yield* encodeJson({ type: "message_stop" }), event: "message_stop" },
      ]);
      const result = yield* Effect.promise(() =>
        streamAnthropic(model, context, {
          client: createFakeAnthropicClient(response),
        }).result(),
      );

      expect(result.usage.cacheWrite).toBe(6535);
      expect(result.usage.cacheWrite1h).toBe(6535);
      expect(result.usage.cost.cacheWrite).toBeCloseTo(
        (6535 * model.cost.input * 2) / 1_000_000,
        10,
      );
    }),
  );

describe("Anthropic 1h cache write cost", () => {
  it("prices 1h cache writes reported only in message_delta", prices1hCacheWritesReportedOnly);
});

const fallsBackToThe5mRate = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = getModel("anthropic-api", "claude-opus-4-8");
      const response = createSseResponse(eventsWithCacheCreation(undefined));
      const result = yield* Effect.promise(() =>
        streamAnthropic(model, context, {
          client: createFakeAnthropicClient(response),
        }).result(),
      );

      expect(result.usage.cacheWrite).toBe(1_000_000);
      expect(result.usage.cacheWrite1h ?? 0).toBe(0);
      expect(result.usage.cost.cacheWrite).toBeCloseTo(6.25, 10);
    }),
  );

describe("Anthropic 1h cache write cost", () => {
  it("falls back to the 5m rate when no breakdown is reported", fallsBackToThe5mRate);
});

function eventsWithCacheCreationStep1(cacheCreation: Record<string, number> | undefined) {
  const startUsage: Record<string, unknown> = {
    cache_creation_input_tokens: 1000000,
    cache_read_input_tokens: 0,
    input_tokens: 100,
    output_tokens: 0,
  };
  if (cacheCreation !== undefined) startUsage["cache_creation"] = cacheCreation;
  return startUsage;
}
