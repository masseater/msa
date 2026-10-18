import { expect, it } from "vite-plus/test";

import { zaiModels } from "../scripts/catalog/models-dev-partners.ts";
import type { ModelsDevCatalog, ModelsDevModel } from "../scripts/catalog/models-dev.ts";
import { getBuiltinModel } from "../src/providers/all.ts";

const model = (id: string, cost: NonNullable<ModelsDevModel["cost"]>): ModelsDevModel => ({
  id,
  name: id,
  tool_call: true,
  cost,
});

const planModels = {
  "glm-priced": model("glm-priced", { input: 0, output: 0 }),
  "glm-unpriced": model("glm-unpriced", { input: 0, output: 0 }),
};

const catalog: ModelsDevCatalog = {
  zai: {
    models: { "glm-priced": model("glm-priced", { input: 1.4, output: 4.4, cache_read: 0.26 }) },
  },
  "zai-coding-plan": { models: planModels },
  "zhipuai-coding-plan": { models: planModels },
};

const generated = zaiModels({ data: catalog, strict: true, remember: () => undefined });

const costOf = (provider: string, id: string) =>
  generated.find((model) => model.provider === provider && model.id === id)?.cost;

it("exposes GLM-4.6V on the China Coding Plan catalog", () => {
  expect(getBuiltinModel("zai-coding-cn", "glm-4.6v")).toMatchObject({
    id: "glm-4.6v",
    provider: "zai-coding-cn",
    api: "openai-completions",
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    input: ["text", "image"],
    compat: {
      maxTokensField: "max_tokens",
      thinkingFormat: "zai",
      zaiToolStream: true,
    },
  });
});

it("uses API-equivalent reference costs for Coding Plan models", () => {
  for (const provider of ["zai", "zai-coding-cn"]) {
    expect(costOf(provider, "glm-priced")).toEqual({
      input: 1.4,
      output: 4.4,
      cacheRead: 0.26,
      cacheWrite: 0,
    });
  }
});

it("keeps zero costs for Coding Plan models without a matching API price", () => {
  for (const provider of ["zai", "zai-coding-cn"]) {
    expect(costOf(provider, "glm-unpriced")).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
  }
});
