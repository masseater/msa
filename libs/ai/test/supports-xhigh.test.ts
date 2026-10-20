import { describe, expect, it } from "vite-plus/test";

import compat from "../src/compat.ts";
import type compatTypes from "../src/compat.types.ts";
import type typesModule from "../src/types.types.ts";
import modelChoice from "./model-choice.ts";

const { getProviders, getSupportedThinkingLevels } = compat;

const { compatValue, modelsWhere } = modelChoice;

const everyModel = (
  accepts: (model: typesModule.Model<typesModule.Api>) => boolean,
): typesModule.Model<typesModule.Api>[] =>
  (getProviders() as compatTypes.BuiltinProvider[]).flatMap((provider) =>
    modelsWhere(provider, accepts),
  );

const mapped = (model: typesModule.Model<typesModule.Api>, level: string) =>
  (model.thinkingLevelMap as Record<string, string | null | undefined> | undefined)?.[level];

const nonEmpty = (models: typesModule.Model<typesModule.Api>[]) => {
  expect(models.length).toBeGreaterThan(0);
  return models;
};

const offersOnlyOffForModelsWithout = () => {
  for (const model of nonEmpty(everyModel((candidate) => !candidate.reasoning))) {
    expect(getSupportedThinkingLevels(model), model.id).toEqual(["off"]);
  }
};

const offersMaxButNotXhighWhen = () => {
  const models = everyModel(
    (model) =>
      model.reasoning &&
      typeof mapped(model, "max") === "string" &&
      mapped(model, "xhigh") === undefined,
  );
  for (const model of nonEmpty(models)) {
    expect(getSupportedThinkingLevels(model), model.id).toContain("max");
    expect(getSupportedThinkingLevels(model), model.id).not.toContain("xhigh");
  }
};

const offersXhighAndMaxWhenBoth = () => {
  const models = everyModel(
    (model) =>
      model.reasoning &&
      typeof mapped(model, "xhigh") === "string" &&
      typeof mapped(model, "max") === "string",
  );
  for (const model of nonEmpty(models)) {
    expect(getSupportedThinkingLevels(model), model.id).toEqual(
      expect.arrayContaining(["xhigh", "max"]),
    );
  }
};

const offersNeitherXhighNorMaxFor = () => {
  const models = everyModel((model) => model.reasoning && model.thinkingLevelMap === undefined);
  for (const model of nonEmpty(models)) {
    expect(getSupportedThinkingLevels(model), model.id).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
    ]);
  }
};

describe("getSupportedThinkingLevels", () => {
  it("offers only off for models without reasoning", offersOnlyOffForModelsWithout);

  it("offers max but not xhigh when only max is mapped", offersMaxButNotXhighWhen);

  it("offers xhigh and max when both are mapped", offersXhighAndMaxWhenBoth);

  it(
    "offers neither xhigh nor max for reasoning models without a level map",
    offersNeitherXhighNorMaxFor,
  );

  it.for(["off", "minimal", "low", "medium", "high", "xhigh", "max"])(
    "omits %s wherever the catalog maps it to null",
    (level) => {
      const models = everyModel((model) => model.reasoning && mapped(model, level) === null);
      for (const model of models) {
        expect(getSupportedThinkingLevels(model), model.id).not.toContain(level);
      }
    },
  );
});

const pricesOpenAIAndCodexLongContext = () => {
  const tiered = (["openai", "openai-codex"] as const).flatMap((provider) =>
    modelsWhere(provider, (model) => (model.cost.tiers?.length ?? 0) > 0),
  );
  for (const { cost, id } of nonEmpty(tiered)) {
    expect(cost.tiers?.[0], id).toEqual({
      cacheRead: expect.closeTo(cost.cacheRead * 2, 10),
      cacheWrite: expect.closeTo(cost.cacheWrite * 2, 10),
      input: expect.closeTo(cost.input * 2, 10),
      inputTokensAbove: 272000,
      output: expect.closeTo(cost.output * 1.5, 10),
    });
  }
};

const letsAnthropicModelsWithManagedEffort = () => {
  const managed = modelsWhere("anthropic-api", (model) => mapped(model, "minimal") === null);
  for (const model of nonEmpty(managed)) {
    for (const flag of [
      "forceAdaptiveThinking",
      "supportsMidConvoEffort",
      "supportsMidConvoSystemMessages",
      "supportsMidConvoToolChanges",
    ]) {
      expect(compatValue(model, flag), `${model.id} ${flag}`).toBe(true);
    }
  }
};

describe("catalog metadata", () => {
  it(
    "prices OpenAI and Codex long-context tiers at double input and 1.5x output",
    pricesOpenAIAndCodexLongContext,
  );

  it(
    "lets Anthropic models with managed effort levels change effort and tools mid-conversation",
    letsAnthropicModelsWithManagedEffort,
  );
});
