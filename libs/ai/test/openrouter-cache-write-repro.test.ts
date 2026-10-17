import { Clock, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { completeSimple, getModel } from "../src/compat.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import { nextRandom } from "../src/utils/random.ts";
import { envValue, readEnv } from "./env.ts";

function createLongSystemPrompt(): string {
  const nonce = `${currentTimeMillis()}-${nextRandom()}`;
  return `You are a concise assistant.\nCache nonce: ${nonce}\n\n${Array(80)
    .fill(
      "Prompt-caching probe content. Keep this exact text stable across requests so the provider can reuse prefix tokens and report cache read and cache write usage.",
    )
    .join("\n\n")}`;
}

describe.skipIf(
  envValue("OPENROUTER_API_KEY") === undefined || envValue("OPENROUTER_API_KEY") === "",
)("OpenRouter cache_write repro E2E", () => {
  it(
    "regression: preserves cache_write_tokens on openai-completions stream path",
    { retry: 2, timeout: 90000 },
    () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const model = getModel("openrouter", "google/gemini-2.5-flash");
          const context = {
            systemPrompt: createLongSystemPrompt(),
            messages: [
              {
                role: "user" as const,
                content: "Reply with exactly: OK",
                timestamp: yield* Clock.currentTimeMillis,
              },
            ],
          };

          const options = {
            apiKey: (yield* readEnv("OPENROUTER_API_KEY"))!,
            maxTokens: 32,
            temperature: 0,
            onPayload: (payload: unknown) => {
              const params = payload as {
                messages?: Array<{
                  role?: string;
                  content?:
                    | string
                    | Array<{ type?: string; text?: string; cache_control?: { type: string } }>;
                }>;
              };
              const messages = params.messages;
              if (!Array.isArray(messages)) return payload;

              for (const msg of messages.toReversed()) {
                if (msg.role !== "user") continue;
                if (typeof msg.content === "string") {
                  msg.content = [
                    { type: "text", text: msg.content, cache_control: { type: "ephemeral" } },
                  ];
                  break;
                }
                if (!Array.isArray(msg.content)) continue;
                for (const part of msg.content.toReversed()) {
                  if (part.type === "text") {
                    part.cache_control = { type: "ephemeral" };
                    break;
                  }
                }
                break;
              }
              return payload;
            },
          };

          const first = yield* Effect.promise(() => completeSimple(model, context, options));
          expect(first.stopReason, first.errorMessage).toBe("stop");

          const second = yield* Effect.promise(() => completeSimple(model, context, options));
          expect(second.stopReason, second.errorMessage).toBe("stop");

          const hasCacheWrite = first.usage.cacheWrite > 0 || second.usage.cacheWrite > 0;
          expect(hasCacheWrite).toBe(true);
        }),
      ),
  );
});
