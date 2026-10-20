import { Clock, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { completeSimple } from "../src/compat.ts";
import type { Context, Model } from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import { nextRandom } from "../src/utils/random.ts";
import env from "./env.ts";
import modelChoice from "./model-choice.ts";

const { hasEnv, readEnv } = env;
const { chooseModel, usesApi } = modelChoice;

type CachePart = { type?: string; text?: string; cache_control?: { type: string } };
type CacheMessage = { role?: string; content?: string | CachePart[] };

const completions = usesApi("openai-completions");

const explicitCacheModel = chooseModel(
  "openrouter",
  "Gemini with billed cache writes",
  (model): model is Model<"openai-completions"> =>
    completions(model) && model.id.startsWith("google/") && model.cost.cacheWrite > 0,
);

function createLongSystemPrompt(): string {
  const nonce = `${currentTimeMillis()}-${nextRandom()}`;
  return `You are a concise assistant.\nCache nonce: ${nonce}\n\n${Array(80)
    .fill(
      "Prompt-caching probe content. Keep this exact text stable across requests so the provider can reuse prefix tokens and report cache read and cache write usage.",
    )
    .join("\n\n")}`;
}

const markLastUserMessage = (payload: unknown): unknown => {
  const { messages } = payload as { messages?: CacheMessage[] };
  const last = Array.isArray(messages)
    ? messages.findLast((message) => message.role === "user")
    : undefined;
  if (last === undefined) return payload;
  if (typeof last.content === "string") {
    last.content = [{ cache_control: { type: "ephemeral" }, text: last.content, type: "text" }];
  } else if (Array.isArray(last.content)) {
    const text = last.content.findLast((part) => part.type === "text");
    if (text !== undefined) text.cache_control = { type: "ephemeral" };
  }
  return payload;
};

const reportsCacheWrites = Effect.gen(function* () {
  const context: Context = {
    messages: [
      {
        content: "Reply with exactly: OK",
        role: "user",
        timestamp: yield* Clock.currentTimeMillis,
      },
    ],
    systemPrompt: createLongSystemPrompt(),
  };
  const options = {
    apiKey: (yield* readEnv("OPENROUTER_API_KEY")) ?? "",
    maxTokens: 32,
    onPayload: markLastUserMessage,
    temperature: 0,
  };
  const first = yield* Effect.promise(() => completeSimple(explicitCacheModel, context, options));
  expect(first.stopReason, first.errorMessage).toBe("stop");
  const second = yield* Effect.promise(() => completeSimple(explicitCacheModel, context, options));
  expect(second.stopReason, second.errorMessage).toBe("stop");
  expect(first.usage.cacheWrite > 0 || second.usage.cacheWrite > 0).toBe(true);
});

describe.skipIf(!hasEnv("OPENROUTER_API_KEY"))("OpenRouter cache_write repro E2E", () => {
  it(
    "regression: preserves cache_write_tokens on openai-completions stream path",
    { retry: 2, timeout: 90000 },
    () => Effect.runPromise(reportsCacheWrites),
  );
});
