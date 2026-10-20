import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { stream } from "../src/api/anthropic-messages.ts";
import { getModel, normalizeContext } from "../src/compat.ts";
import type { AssistantMessage, Context } from "../src/types.ts";
import env from "./env.ts";

const { envValue } = env;

const enabled = Boolean(envValue("ANTHROPIC_API_KEY"));
const model = getModel("anthropic-api", "claude-fable-5-1");
const user = (content: string, timestamp: number) => ({
  content,
  role: "user" as const,
  timestamp,
});

function strictBinding(payload: unknown): unknown {
  const params = payload as {
    thinking?: {
      block_binding?: { prefix_mismatch_behavior?: "drop_block" | "error" };
    };
  };
  if (params.thinking?.block_binding !== undefined) {
    params.thinking.block_binding.prefix_mismatch_behavior = "error";
  }
  return params;
}

function request(context: Context, effort: "low" | "high"): Promise<AssistantMessage> {
  return Promise.resolve(
    stream(model, normalizeContext(context), {
      apiKey: envValue("ANTHROPIC_API_KEY"),
      cacheRetention: "none",
      effort,
      maxTokens: 1536,
      onPayload: strictBinding,
      thinkingDisplay: "summarized",
      thinkingEnabled: true,
    }).result(),
  );
}

describe.skipIf(!enabled)("Anthropic thinking binding conformance", () => {
  it("replays managed effort markers required by signed Fable thinking", { timeout: 120000 }, () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const firstUser = user(
          "Compute 982451653 multiplied by 961748941. Return only the integer.",
          1,
        );
        const first = yield* Effect.promise(() => request({ messages: [firstUser] }, "low"));
        expect(first.stopReason, first.errorMessage).toBe("stop");
        expect(
          first.content.some(
            (block) =>
              block.type === "thinking" &&
              typeof block.thinkingSignature === "string" &&
              block.thinkingSignature.length > 0,
          ),
        ).toBe(true);
        expect(first.providerThinkingLevel).toBe("low");

        const secondUser = user("Reply with exactly: ok", 2);
        const exact = yield* Effect.promise(() =>
          request({ messages: [firstUser, first, secondUser] }, "high"),
        );
        expect(exact.stopReason, exact.errorMessage).toBe("stop");

        const unmanagedHistory: AssistantMessage = { ...first };
        delete unmanagedHistory.providerThinkingLevel;
        const missingMarker = yield* Effect.promise(() =>
          request({ messages: [firstUser, unmanagedHistory, secondUser] }, "high"),
        );
        expect(missingMarker.stopReason).toBe("error");
        expect(missingMarker.errorMessage).toContain("Invalid `signature`");
      }),
    ),
  );
});
