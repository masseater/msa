import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type typesModule from "../src/types.types.ts";
import env from "./env.ts";
import liveAuth from "./live-auth.ts";
import modelChoice from "./model-choice.ts";
import totalTokensSupport from "./total-tokens-support.ts";

const { hasLiveAuth } = liveAuth;

const { expectTotalTokens } = totalTokensSupport;
const { hasEnv } = env;
const { chooseModel, usesApi } = modelChoice;

const retried = { retry: 3, timeout: 60000 };

const anthropicReportsCachedTotals = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = chooseModel("anthropic-api", "Messages", usesApi("anthropic-messages"));
      const { first, second } = yield* expectTotalTokens("Anthropic", model, {});
      expect(second.cacheRead > 0 || second.cacheWrite > 0 || first.cacheWrite > 0).toBe(true);
    }),
  );

const openAICompletionsModel = (): typesModule.Model<"openai-completions"> => {
  const { compat: _compat, ...baseModel } = chooseModel("openai", "direct OpenAI");
  return { ...baseModel, api: "openai-completions" };
};

describe("totalTokens field", () => {
  it.skipIf(!hasLiveAuth("anthropic-api"))(
    "Anthropic returns totalTokens equal to sum of components",
    retried,
    anthropicReportsCachedTotals,
  );
  it.skipIf(!hasEnv("OPENAI_API_KEY"))(
    "OpenAI Completions returns totalTokens equal to sum of components",
    retried,
    () => Effect.runPromise(expectTotalTokens("OpenAI Completions", openAICompletionsModel())),
  );
  it.skipIf(!hasEnv("OPENAI_API_KEY"))(
    "OpenAI Responses returns totalTokens equal to sum of components",
    retried,
    () =>
      Effect.runPromise(
        expectTotalTokens(
          "OpenAI Responses",
          chooseModel("openai", "Responses", usesApi("openai-responses")),
        ),
      ),
  );
});
