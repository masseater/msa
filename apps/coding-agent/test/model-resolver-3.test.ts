import all from "@msa/ai/providers/all";
import { describe, expect, test } from "vite-plus/test";

import modelResolver from "../src/core/model-resolver.ts";

const { defaultModelFor, defaultModelPerProvider } = modelResolver;

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
      defaultModelFor(provider, chatModels),
      `${provider} default ${defaultId} should resolve to a model in its generated catalog`,
    ).toBeDefined();
  }
};

const staleDefaultFollowsTheCatalog = () => {
  const catalog = getBuiltinModels("opencode");
  const successor = catalog.find((model) => model.id === defaultModelPerProvider.opencode);
  expect(successor).toBeDefined();
  const withoutDefault = catalog.filter((model) => model !== successor);
  const followed = defaultModelFor("opencode", withoutDefault);
  expect(followed?.provider).toBe("opencode");
  expect(followed?.id).not.toBe(successor?.id);
  expect(followed?.id.startsWith("kimi")).toBe(true);
};

describe("default model selection", () => {
  test("openai defaults track current models", openaiDefaultsTrackCurrentModels);

  test(
    "built-in chat providers have defaults in their generated catalogs",
    builtInChatProvidersHaveDefaultsIn,
  );

  test(
    "a default that left the catalog resolves to the same family",
    staleDefaultFollowsTheCatalog,
  );
});
