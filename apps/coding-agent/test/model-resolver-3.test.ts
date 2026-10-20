import all from "@msa/ai/providers/all";
import { describe, expect, test } from "vite-plus/test";

import { defaultModelPerProvider } from "../src/core/model-resolver.ts";

const { getBuiltinModels, getBuiltinProviders } = all;

const openaiDefaultsTrackCurrentModels = () => {
  expect(defaultModelPerProvider.openai).toBe("gpt-5.5");
  expect(defaultModelPerProvider["openai-codex"]).toBe("gpt-6.1-sol");
};

const builtInChatProvidersHaveDefaultsIn = () => {
  for (const provider of getBuiltinProviders()) {
    const chatModels = getBuiltinModels(provider);
    const defaultId = defaultModelPerProvider[provider];
    if (chatModels.length === 0) {
      expect(
        defaultId,
        `${provider} has no chat models and should have no chat default`,
      ).toBeUndefined();
      continue;
    }
    expect(
      chatModels.some((model) => model.id === defaultId),
      `${provider} default ${defaultId} should exist in its generated catalog`,
    ).toBe(true);
  }
};

describe("default model selection", () => {
  test("openai defaults track current models", openaiDefaultsTrackCurrentModels);

  test(
    "built-in chat providers have defaults in their generated catalogs",
    builtInChatProvidersHaveDefaultsIn,
  );
});
