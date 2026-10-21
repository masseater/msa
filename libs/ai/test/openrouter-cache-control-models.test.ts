import { describe, expect, it } from "vite-plus/test";

import modelChoice from "./model-choice.ts";

const { compatValue, modelsWhere } = modelChoice;

const anthropicLatestAliases = modelsWhere("openrouter", (model) =>
  model.id.startsWith("~anthropic/"),
);

describe("OpenRouter Anthropic latest alias metadata", () => {
  it("lists Anthropic latest aliases", () => {
    expect(anthropicLatestAliases.length).toBeGreaterThan(0);
  });

  it.for(anthropicLatestAliases)("keeps completions cache control for $id", (model) => {
    expect(model.api).toBe("openai-completions");
    expect(compatValue(model, "cacheControlFormat")).toBe("anthropic");
  });
});
