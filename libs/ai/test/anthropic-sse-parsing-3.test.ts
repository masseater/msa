import type Anthropic from "@anthropic-ai/sdk";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import anthropicMessages from "../src/api/anthropic-messages.ts";
import compat from "../src/compat.ts";
import anthropicSseParsingSupport from "./anthropic-sse-parsing-support.ts";
import modelChoice from "./model-choice.ts";

const { stream: streamAnthropic } = anthropicMessages;
const { normalizeContext } = compat;

const { chooseModel, usesApi } = modelChoice;

const { createSseResponse, minimalAnthropicEvents } = anthropicSseParsingSupport;

const forcesStreamingAfterAnOnPayloadReplacement = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const streaming: { value: boolean | undefined } = { value: undefined };
      const client = {
        beta: {
          messages: {
            create: (params: { stream?: boolean }) => {
              streaming.value = params.stream;
              return {
                asResponse: () => Promise.resolve(createSseResponse(minimalAnthropicEvents)),
              };
            },
          },
        },
      } as unknown as Anthropic;

      yield* Effect.promise(() =>
        streamAnthropic(
          chooseModel("anthropic-api", "Messages", usesApi("anthropic-messages")),
          normalizeContext({ messages: [{ content: "Hello", role: "user", timestamp: 1 }] }),
          {
            client,
            onPayload: (payload) => ({ ...(payload as Record<string, unknown>), stream: false }),
          },
        ).result(),
      );

      expect(streaming.value).toBe(true);
    }),
  );

const omitsTheInterleavedThinkingBetaWhen = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const betaFeatures: { value: string[] | undefined } = { value: undefined };
      const client = {
        beta: {
          messages: {
            create: (params: { betas?: string[] }) => {
              betaFeatures.value = params.betas;
              return {
                asResponse: () => Promise.resolve(createSseResponse(minimalAnthropicEvents)),
              };
            },
          },
        },
      } as unknown as Anthropic;

      yield* Effect.promise(() =>
        streamAnthropic(
          chooseModel("openrouter", "Messages", usesApi("anthropic-messages")),
          normalizeContext({ messages: [{ content: "Hello", role: "user", timestamp: 1 }] }),
          { client, thinkingEnabled: false },
        ).result(),
      );

      expect(betaFeatures.value ?? []).not.toContain("interleaved-thinking-2025-05-14");
    }),
  );

const passesManagedBetaFeaturesToInjected = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const betaFeatures: { value: string[] | undefined } = { value: undefined };
      const client = {
        beta: {
          messages: {
            create: (params: { betas?: string[] }) => {
              betaFeatures.value = params.betas;
              return {
                asResponse: () => Promise.resolve(createSseResponse(minimalAnthropicEvents)),
              };
            },
          },
        },
      } as unknown as Anthropic;

      const result = yield* Effect.promise(() =>
        streamAnthropic(
          chooseModel("anthropic-api", "Messages", usesApi("anthropic-messages")),
          normalizeContext({ messages: [{ content: "Hello", role: "user", timestamp: 1 }] }),
          { client },
        ).result(),
      );

      expect(result.stopReason).toBe("stop");
      expect(betaFeatures.value).toContain("mid-conversation-output-config-2026-07-01");
      expect(betaFeatures.value).toContain("thinking-binding-controls-2026-08-01");
    }),
  );

describe("Anthropic raw SSE parsing", () => {
  it("forces streaming after an onPayload replacement", forcesStreamingAfterAnOnPayloadReplacement);
});

describe("Anthropic raw SSE parsing", () => {
  it(
    "omits the interleaved-thinking beta when thinking is disabled",
    omitsTheInterleavedThinkingBetaWhen,
  );
});

describe("Anthropic raw SSE parsing", () => {
  it("passes managed beta features to injected clients", passesManagedBetaFeaturesToInjected);
});
