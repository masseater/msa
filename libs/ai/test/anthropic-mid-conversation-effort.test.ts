import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type typesModule from "../src/types.types.ts";
import anthropicMidConversationEffortSupport from "./anthropic-mid-conversation-effort-support.ts";

const { capture, managedModel, user } = anthropicMidConversationEffortSupport;

interface WireMessage {
  role: string;
  content: unknown;
  output_config?: { effort?: string };
}

interface CapturedPayload {
  messages: WireMessage[];
  thinking?: {
    type: string;
    display?: string;
    block_binding?: { prefix_mismatch_behavior?: string };
  };
  output_config?: { effort?: string };
  fallbacks?: Array<{ model: string }>;
}

function assistant(
  model: typesModule.Model<"anthropic-messages">,
  level?: string,
): typesModule.AssistantMessage {
  return {
    api: "anthropic-messages",
    content: [
      { thinking: "reasoning", thinkingSignature: "signature", type: "thinking" },
      { text: "answer", type: "text" },
    ],
    model: model.id,
    provider: model.provider,
    role: "assistant",
    stopReason: "stop",
    timestamp: 1,
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
    ...(level === undefined ? {} : { providerThinkingLevel: level }),
  };
}

function effortMessages(payload: CapturedPayload): WireMessage[] {
  return payload.messages.filter((message) => message.role === "system");
}

describe("Anthropic mid-conversation effort", () => {
  it("reconstructs an exact historical marker prefix and appends the current marker", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = managedModel();
        const first = yield* capture(model, { messages: [user("one", 1)] }, { effort: "low" });
        const second = yield* capture(
          model,
          { messages: [user("one", 1), assistant(model, "low"), user("two", 2)] },
          { effort: "high" },
        );

        expect(first.payload.messages).toEqual([
          { content: "one", role: "user" },
          { content: [], output_config: { effort: "low" }, role: "system" },
        ]);
        expect(second.payload.messages.slice(0, first.payload.messages.length)).toEqual(
          first.payload.messages,
        );
        expect(second.payload.messages.at(-1)).toEqual({
          content: [],
          output_config: { effort: "high" },
          role: "system",
        });
        expect(first.payload.output_config).toEqual({ effort: "high" });
        expect(second.payload.output_config).toEqual({ effort: "high" });
        expect(second.payload.thinking).toEqual({
          block_binding: { prefix_mismatch_behavior: "drop_block" },
          display: "summarized",
          type: "adaptive",
        });
        expect(first.message.providerThinkingLevel).toBe("low");
      }),
    ));
});

describe("Anthropic mid-conversation effort", () => {
  it.each(["low", "medium", "high", "xhigh", "max"] as const)(
    "preserves native effort %s",
    (effort) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const model = managedModel();
          const { payload, message } = yield* capture(
            model,
            { messages: [user("one", 1)] },
            { effort },
          );
          expect(effortMessages(payload)).toEqual([
            { content: [], output_config: { effort }, role: "system" },
          ]);
          expect(message.providerThinkingLevel).toBe(effort);
        }),
      ),
  );

  it("defaults omitted effort to high and still enables drop_block", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { payload, message } = yield* capture(managedModel(), { messages: [user("one", 1)] });
        expect(payload.messages.at(-1)).toEqual({
          content: [],
          output_config: { effort: "high" },
          role: "system",
        });
        expect(payload.thinking?.block_binding?.prefix_mismatch_behavior).toBe("drop_block");
        expect(message.providerThinkingLevel).toBe("high");
      }),
    ));
});

describe("Anthropic mid-conversation effort", () => {
  it("does not invent markers for legacy or other-provider assistants", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = managedModel();
        const legacy = assistant(model);
        const otherProvider = { ...assistant(model, "low"), provider: "other-provider" };
        const { payload } = yield* capture(
          model,
          { messages: [user("one", 1), legacy, user("two", 2), otherProvider, user("three", 3)] },
          { effort: "medium" },
        );
        expect(effortMessages(payload)).toEqual([
          { content: [], output_config: { effort: "medium" }, role: "system" },
        ]);
      }),
    ));
});

describe("Anthropic mid-conversation effort", () => {
  it("sends plain disabled thinking without effort when off is supported", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = managedModel();
        model.thinkingLevelMap = {
          high: "high",
          low: "low",
          max: "max",
          medium: "medium",
          minimal: null,
        };
        const { payload, message } = yield* capture(
          model,
          {
            messages: [
              user("one", 1),
              assistant(model, "low"),
              user("two", 2),
              assistant(model, "medium"),
              user("three", 3),
            ],
          },
          { thinkingEnabled: false },
        );
        expect(payload.thinking).toEqual({ type: "disabled" });
        expect(payload.output_config).toBeUndefined();
        expect(effortMessages(payload)).toEqual([]);
        expect(message.providerThinkingLevel).toBeUndefined();
      }),
    ));

  it("keeps adaptive thinking when off is unsupported", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { payload, message } = yield* capture(
          managedModel(),
          { messages: [user("one", 1)] },
          { thinkingEnabled: false },
        );
        expect(payload.thinking?.type).toBe("adaptive");
        expect(effortMessages(payload)).toEqual([
          { content: [], output_config: { effort: "high" }, role: "system" },
        ]);
        expect(message.providerThinkingLevel).toBe("high");
      }),
    ));
});
