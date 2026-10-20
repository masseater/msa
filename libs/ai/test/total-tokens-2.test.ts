import { Effect } from "effect";
import { describe, inject, it } from "vite-plus/test";

import env from "./env.ts";
import modelChoice from "./model-choice.ts";
import totalTokensSupport from "./total-tokens-support.ts";

const { expectTotalTokens } = totalTokensSupport;
const { hasEnv, hasValue, readEnv } = env;
const { chooseModel, usesApi } = modelChoice;

const openaiCodexToken = inject("storedApiKeys")["openai-codex"];
const retried = { retry: 3, timeout: 60000 };
const openRouterVendors = ["anthropic", "deepseek", "mistralai", "google"];

const openRouterVendorTotals = (vendor: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = chooseModel(
        "openrouter",
        `${vendor} completions`,
        (candidate) =>
          usesApi("openai-completions")(candidate) && candidate.id.startsWith(`${vendor}/`),
      );
      yield* expectTotalTokens("OpenRouter", model, {
        apiKey: yield* readEnv("OPENROUTER_API_KEY"),
      });
    }),
  );

describe("totalTokens field", () => {
  it.skipIf(!hasEnv("OPENROUTER_API_KEY")).for(openRouterVendors)(
    "OpenRouter %s returns totalTokens equal to sum of components",
    retried,
    openRouterVendorTotals,
  );
  it.skipIf(!hasValue(openaiCodexToken))(
    "OpenAI Codex returns totalTokens equal to sum of components",
    retried,
    () =>
      Effect.runPromise(
        expectTotalTokens("OpenAI Codex", chooseModel("openai-codex", "Codex"), {
          apiKey: openaiCodexToken,
        }),
      ),
  );
});
