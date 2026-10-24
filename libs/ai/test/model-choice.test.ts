import { describe, expect, it } from "vite-plus/test";

import modelChoice from "./model-choice.ts";

const { CHATGPT_ACCOUNT_REJECTED_MODELS, cheapestUsable, chooseModel } = modelChoice;

const rejected = CHATGPT_ACCOUNT_REJECTED_MODELS["openai-codex"] ?? [];

const codexModel = (id: string, input: number) => ({
  cost: { input, output: 0 },
  id,
  provider: "openai-codex",
});

describe("chooseModel", () => {
  it("skips the Codex models a ChatGPT account rejects even when they are the cheapest", () => {
    const models = [
      ...rejected.map((id, index) => codexModel(id, index)),
      codexModel("gpt-usable", 100),
    ];
    expect(cheapestUsable(models)?.id).toBe("gpt-usable");
  });

  it("keeps a rejected id usable on a provider that accepts it", () => {
    const [id = ""] = rejected;
    expect(cheapestUsable([{ ...codexModel(id, 0), provider: "openai" }])?.id).toBe(id);
  });

  it("picks a Codex model a ChatGPT account accepts from the catalog", () => {
    expect(rejected).not.toContain(chooseModel("openai-codex", "Codex").id);
  });
});
