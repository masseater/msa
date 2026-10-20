import type {
  BetaTool,
  MessageCreateParamsStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages.js";
import { Effect, Stream } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { stream as streamAnthropic } from "../src/api/anthropic-messages.ts";
import type { TranscriptContext } from "../src/types.ts";
import anthropicStrictToolFallbackSupport from "./anthropic-strict-tool-fallback-support.ts";
import jsonCodec from "./json-codec.ts";

const { context, errorResponse, grammarError, harness, model, successResponse, tool } =
  anthropicStrictToolFallbackSupport;

const { encodeJson } = jsonCodec;

const downgradesInlineAdditionsAndSameName = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const transcript = context([tool("lookup", "require")]);
      transcript.messages.push(
        { content: "", role: "system", timestamp: 2, toolsAdded: [tool("lookup", "prefer")] },
        { content: "", role: "system", timestamp: 3, toolsAdded: [tool("lookup", "require")] },
      );
      const { payloads, options } = harness((_payload, attempt) =>
        attempt === 1 ? errorResponse() : successResponse(),
      );
      const result = yield* Effect.promise(() =>
        streamAnthropic(
          {
            ...model,
            compat: {
              ...model.compat,
              supportsMidConvoSystemMessages: true,
              supportsMidConvoToolChanges: true,
            },
          },
          transcript,
          { ...options, apiKey: "sk-ant-test" },
        ).result(),
      );
      expect(result.stopReason).toBe("stop");
      expect(payloads).toHaveLength(2);
      expect(payloads[1]?.tools).toEqual(payloads[0]?.tools);
      const additions = payloads.map((payload) =>
        payload.messages.flatMap((message) =>
          Array.isArray(message.content)
            ? message.content.flatMap((block) =>
                block.type === "tool_addition" && block.tool.type === "tool_definition"
                  ? [block.tool.definition as BetaTool]
                  : [],
              )
            : [],
        ),
      );
      const [firstAdditions, secondAdditions] = additions;
      if (firstAdditions === undefined || secondAdditions === undefined)
        throw new Error("Expected two tool additions");
      expect(firstAdditions.map((definition) => definition.strict)).toEqual([true, true]);
      expect(secondAdditions.map((definition) => definition.strict)).toEqual([undefined, true]);
      expect(secondAdditions[0]?.input_schema.required).toEqual(["value"]);
      expect(secondAdditions[1]).toEqual(firstAdditions[1]);
    }),
  );

const retriesSWithOriginalStep1 = (
  transcript: TranscriptContext,
  options: {
    apiKey: string;
    fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
    maxRetries: number;
  },
  payloads: MessageCreateParamsStreaming[],
) =>
  Effect.gen(function* () {
    const onPayload = vi.fn((payload: unknown) => ({
      ...(payload as MessageCreateParamsStreaming),
      inference_geo: "us",
      stream: false,
    }));
    const onResponse = vi.fn();
    const stream = streamAnthropic(model, transcript, {
      ...options,
      cacheRetention: "long",
      onPayload,
      onResponse,
    });
    const events: string[] = [];
    yield* Stream.fromAsyncIterable(stream, (error) => error).pipe(
      Stream.orDie,
      Stream.runForEach((event) =>
        Effect.sync(() => {
          events.push(event.type);
        }),
      ),
    );
    const result = yield* Effect.promise(() => stream.result());

    expect(result.stopReason).toBe("stop");
    expect(events).toEqual(["start", "done"]);
    expect(payloads).toHaveLength(2);
    expect(onPayload).toHaveBeenCalledTimes(2);
    expect(onResponse).toHaveBeenCalledTimes(1);
    const first = payloads[0]?.tools as BetaTool[];
    const second = payloads[1]?.tools as BetaTool[];
    expect(first[0]).toMatchObject({
      input_schema: {
        properties: { optional: { anyOf: [{ type: "number" }, { type: "null" }] } },
        required: ["optional", "value"],
      },
      strict: true,
    });
    expect(second[0]?.strict).toBeUndefined();
    return { first, result, second };
  });

describe("Anthropic preferred strict tool fallback", () => {
  it.each([
    grammarError,
    "Too many strict tools (32). The maximum number of strict tools supported is 20. Try reducing the number of tools marked as strict.",
    "Schemas contains too many parameters with union types (480 parameters with type arrays or anyOf). This causes exponential compilation cost. Reduce the number of nullable or union-typed parameters (limit: 16 parameters with unions).",
  ])("retries %s with original non-strict schemas and preserves required tools", (message) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const preferred = tool("preferred", "prefer");
        const required = tool("required", "require");
        const ordinary = tool("ordinary");
        const transcript = context([preferred, required, ordinary]);
        const original = yield* encodeJson(transcript);
        const { payloads, options } = harness((_payload, attempt) =>
          attempt === 1 ? errorResponse(message) : successResponse(),
        );
        const { second, first, result } = yield* retriesSWithOriginalStep1(
          transcript,
          options,
          payloads,
        );
        expect(second[0]?.input_schema).toEqual({
          properties: { optional: { type: "number" }, value: { type: "string" } },
          required: ["value"],
          type: "object",
        });
        expect(second[1]).toEqual(first[1]);
        expect(second[1]?.strict).toBe(true);
        expect(second[2]).toEqual(first[2]);
        expect(second[2]?.cache_control).toEqual({ ttl: "1h", type: "ephemeral" });
        expect(payloads.map((payload) => payload.stream)).toEqual([true, true]);
        expect(payloads[1]).toMatchObject({ inference_geo: "us" });
        expect(yield* encodeJson(transcript)).toBe(original);
        expect(result.diagnostics?.[0]).toMatchObject({
          details: { reason: "strict_tool_limits_exceeded" },
          type: "anthropic_strict_tools_fallback",
        });
      }),
    ),
  );
});

describe("Anthropic preferred strict tool fallback", () => {
  it(
    "downgrades inline additions and same-name redefinitions without downgrading require",
    downgradesInlineAdditionsAndSameName,
  );
});
