import { Clock, Effect, Schema } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import anthropicMessages from "../src/api/anthropic-messages.ts";
import type typesModule from "../src/types.types.ts";
import transcript from "../src/utils/transcript.ts";

const { stream: streamAnthropic } = anthropicMessages;
const { normalizeContext } = transcript;

interface AnthropicToolPayload {
  tools?: Array<{ strict?: boolean; input_schema: Record<string, unknown> }>;
}

class PayloadCaptured extends Schema.TaggedError<
  PayloadCaptured,
  { readonly brand: unique symbol }
>()("PayloadCaptured", { message: Schema.String }) {}

function createModel(): typesModule.Model<"anthropic-messages"> {
  return {
    api: "anthropic-messages",
    baseUrl: "http://127.0.0.1:9",
    compat: { forceAdaptiveThinking: true, supportsStrictTools: true },
    contextWindow: 200000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: "claude-opus-4-8",
    input: ["text"],
    maxTokens: 32000,
    name: "Claude Opus 4.8",
    provider: "test-anthropic",
    reasoning: true,
  };
}

function createTool(
  parameters: typesModule.Tool["parameters"],
  constrainedSampling?: typesModule.Tool["constrainedSampling"],
): typesModule.Tool {
  return {
    description: "Look up a value",
    name: "lookup",
    parameters,
    ...(constrainedSampling !== undefined && constrainedSampling !== false
      ? { constrainedSampling }
      : {}),
  };
}

function createStrictTool(parameters: typesModule.Tool["parameters"]): typesModule.Tool {
  return createTool(parameters, { strict: "prefer", type: "json_schema" });
}

const captureFirstTool = Effect.fn("captureFirstTool")(function* (tool: typesModule.Tool) {
  let payload: AnthropicToolPayload | undefined;
  const stream = streamAnthropic(
    createModel(),
    normalizeContext({
      messages: [
        { content: "Use the tool", role: "user", timestamp: yield* Clock.currentTimeMillis },
      ],
      tools: [tool],
    }),
    {
      apiKey: "test-key",
      cacheRetention: "none",
      onPayload: (value) => {
        payload = value as AnthropicToolPayload;
        throw PayloadCaptured.make({ message: "payload captured" });
      },
    },
  );
  yield* Effect.promise(() => stream.result());

  const firstTool = payload?.tools?.[0];
  if (firstTool === undefined) {
    throw new Error("Expected a tool in the captured Anthropic payload");
  }
  return firstTool;
});

describe("Anthropic strict tool schemas", () => {
  it("only sends the full input schema for strict JSON-schema tools", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const legacyParameters = Type.Object(
          { value: Type.String() },
          { additionalProperties: false, title: "LookupInput" },
        );
        const legacyTool = yield* captureFirstTool(createTool(legacyParameters));
        expect(legacyTool.strict).toBeUndefined();
        expect(legacyTool.input_schema).toEqual({
          properties: legacyParameters.properties,
          required: legacyParameters.required,
          type: "object",
        });

        const strictTool = yield* captureFirstTool(
          createStrictTool(
            Type.Object(
              { optional: Type.Optional(Type.Number()), value: Type.String() },
              { title: "StrictLookupInput" },
            ),
          ),
        );
        expect(strictTool.strict).toBe(true);
        expect(strictTool.input_schema).toMatchObject({
          additionalProperties: false,
          properties: { optional: { anyOf: [{ type: "number" }, { type: "null" }] } },
          required: ["optional", "value"],
          title: "StrictLookupInput",
        });
      }),
    ));
});

describe("Anthropic strict tool schemas", () => {
  it("sends prefer tools non-strict when they use keywords Anthropic strict mode rejects", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const unsupportedParameters: typesModule.Tool["parameters"][] = [
          Type.Object({ timeoutMs: Type.Optional(Type.Integer({ maximum: 300000, minimum: 1 })) }),
          Type.Object({
            options: Type.Object({ tags: Type.Array(Type.String(), { minItems: 2 }) }),
          }),
          Type.Object({ expression: Type.String({ format: "regex" }) }),
        ];
        for (const parameters of unsupportedParameters) {
          const tool = yield* captureFirstTool(createStrictTool(parameters));
          expect(tool.strict).toBeUndefined();
        }

        const supportedTool = yield* captureFirstTool(
          createStrictTool(
            Type.Object({
              code: Type.String({ maxLength: 1000, minLength: 1, pattern: "^[a-z]+$" }),
              tags: Type.Array(Type.String(), { minItems: 1 }),
              url: Type.String({ format: "uri" }),
            }),
          ),
        );
        expect(supportedTool.strict).toBe(true);
      }),
    ));
});
