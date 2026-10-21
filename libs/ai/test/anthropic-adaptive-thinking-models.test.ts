import { describe, expect, it } from "vite-plus/test";

import compatModule from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";

const { getModels, getProviders } = compatModule;

const EXPECTED_CURRENT_ADAPTIVE_THINKING_MODELS = [
  "anthropic-api/claude-fable-5",
  "anthropic-api/claude-haiku-5-5",
  "anthropic-api/claude-opus-4-8",
  "anthropic-api/claude-opus-5",
  "anthropic-api/claude-sonnet-5",
  "opencode/claude-opus-4-8",
  "opencode/claude-opus-5",
];

function getAllModels(): typesModule.Model<typesModule.Api>[] {
  return getProviders().flatMap(
    (provider) => getModels(provider) as typesModule.Model<typesModule.Api>[],
  );
}

describe("Anthropic adaptive thinking model metadata", () => {
  it("marks built-in Anthropic Messages models that use adaptive thinking", () => {
    const flaggedModels = getAllModels()
      .filter(
        (model): model is typesModule.Model<"anthropic-messages"> =>
          model.api === "anthropic-messages",
      )
      .filter((model) => model.compat?.forceAdaptiveThinking === true)
      .map((model) => `${model.provider}/${model.id}`)
      .sort();

    expect(flaggedModels).toEqual(
      expect.arrayContaining([...EXPECTED_CURRENT_ADAPTIVE_THINKING_MODELS].sort()),
    );
    expect(flaggedModels).toEqual(
      flaggedModels.filter((modelId) =>
        /(opus[-.](4[-.][678]|5)|sonnet[-.]4[-.]6|sonnet[-.]5|haiku[-.]5[-.]5|fable[-.]5)/u.test(
          modelId,
        ),
      ),
    );
  });
});
