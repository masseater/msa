import { describe, inject, it } from "vite-plus/test";

import type typesModule from "../src/types.types.ts";
import contextOverflowSupport from "./context-overflow-support.ts";
import env from "./env.ts";
import modelChoice from "./model-choice.ts";

const { expectOverflowDetected } = contextOverflowSupport;
const { envValue, hasEnv, hasValue } = env;
const { chooseModel, usesApi } = modelChoice;

const openaiCodexToken = inject("storedApiKeys")["openai-codex"];
const slow = { timeout: 120000 };

const openAICompletionsModel = (): typesModule.Model<"openai-completions"> => {
  const { compat: _compat, ...baseModel } = chooseModel("openai", "direct OpenAI");
  return { ...baseModel, api: "openai-completions" };
};

const openRouterVendorModel = (vendor: string) =>
  chooseModel(
    "openrouter",
    `${vendor} completions`,
    (model) => usesApi("openai-completions")(model) && model.id.startsWith(`${vendor}/`),
  );

describe("Context overflow error handling", () => {
  it.skipIf(!hasEnv("ANTHROPIC_API_KEY"))("detects Anthropic overflow", slow, () =>
    expectOverflowDetected(
      chooseModel("anthropic-api", "Messages", usesApi("anthropic-messages")),
      envValue("ANTHROPIC_API_KEY"),
      /prompt is too long/iu,
    ),
  );
  it.skipIf(!hasEnv("OPENAI_API_KEY"))("detects OpenAI Completions overflow", slow, () =>
    expectOverflowDetected(
      openAICompletionsModel(),
      envValue("OPENAI_API_KEY"),
      /maximum context length/iu,
    ),
  );
  it.skipIf(!hasEnv("OPENAI_API_KEY"))("detects OpenAI Responses overflow", slow, () =>
    expectOverflowDetected(
      chooseModel("openai", "Responses", usesApi("openai-responses")),
      envValue("OPENAI_API_KEY"),
      /exceeds the context window/iu,
    ),
  );
  it.skipIf(!hasValue(openaiCodexToken))("detects OpenAI Codex overflow", slow, () =>
    expectOverflowDetected(chooseModel("openai-codex", "Codex"), openaiCodexToken),
  );
  it
    .skipIf(!hasEnv("OPENROUTER_API_KEY"))
    .for(["anthropic", "deepseek", "mistralai", "google", "meta-llama"])(
    "detects OpenRouter %s overflow",
    slow,
    (vendor) =>
      expectOverflowDetected(
        openRouterVendorModel(vendor),
        envValue("OPENROUTER_API_KEY"),
        /maximum context length is \d+ tokens/iu,
      ),
  );
});
