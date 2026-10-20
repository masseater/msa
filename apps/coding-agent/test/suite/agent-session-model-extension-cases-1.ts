import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import { Effect } from "effect";
import { expect } from "vite-plus/test";

import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { createHarness } = harnessModule;

const harnesses: harnessTypes.Harness[] = [];
const setmodelSavesTheModelToThe = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const modelEvents: string[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("model_select", (event) =>
            runPromise(
              Effect.sync(() => {
                modelEvents.push(
                  `${event.previousModel?.id ?? "none"}->${event.model.id}:${event.source}`,
                );
              }),
            ),
          );
        },
      ],
      models: [
        { id: "faux-1", name: "One", reasoning: true },
        { id: "faux-2", name: "Two", reasoning: true },
      ],
    }),
  );
  harnesses.push(harness);
  const nextModel = harness.getModel("faux-2")!;

  yield* Effect.promise(() => harness.session.setModel(nextModel));

  expect(harness.session.model?.id).toBe("faux-2");
  expect(modelEvents).toEqual(["faux-1->faux-2:set"]);
  expect(
    harness.sessionManager
      .getEntries()
      .filter((entry) => entry.type === "model_change")
      .map((entry) => `${entry.provider}/${entry.modelId}`),
  ).toEqual([`${nextModel.provider}/${nextModel.id}`]);
  expect(harness.settingsManager.getDefaultProvider()).toBeUndefined();
  expect(harness.settingsManager.getDefaultModel()).toBeUndefined();
});
const onlyPersistsModelAndThinkingDefaults = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [
        { id: "faux-1", name: "One", reasoning: true },
        { id: "faux-2", name: "Two", reasoning: true },
      ],
    }),
  );
  harnesses.push(harness);
  const nextModel = harness.getModel("faux-2")!;

  yield* Effect.promise(() => harness.session.setModel(nextModel));
  expect(harness.settingsManager.getDefaultProvider()).toBeUndefined();
  expect(harness.settingsManager.getDefaultModel()).toBeUndefined();

  harness.session.setThinkingLevel("low");
  expect(harness.settingsManager.getDefaultThinkingLevel()).toBeUndefined();

  yield* Effect.promise(() => harness.session.setModel(nextModel, { persist: true }));
  expect(harness.settingsManager.getDefaultProvider()).toBe(nextModel.provider);
  expect(harness.settingsManager.getDefaultModel()).toBe(nextModel.id);

  harness.session.setThinkingLevel("high", { persist: true });
  expect(harness.settingsManager.getDefaultThinkingLevel()).toBe("high");
});
const persistsTheRequestedDefaultThinkingLevel = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({ models: [{ id: "faux-1", reasoning: true }] }),
  );
  harnesses.push(harness);

  harness.session.setThinkingLevel("max", { persist: true });

  expect(harness.session.thinkingLevel).toBe("high");
  expect(harness.settingsManager.getDefaultThinkingLevel()).toBe("max");
});
const cyclemodelAndCyclethinkinglevelAreSessionOnly = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [
        { id: "faux-1", name: "One", reasoning: true },
        { id: "faux-2", name: "Two", reasoning: true },
      ],
      settings: {
        defaultModel: "faux-1",
        defaultProvider: "faux",
        defaultThinkingLevel: "low",
      },
    }),
  );
  harnesses.push(harness);

  yield* Effect.promise(() => harness.session.cycleModel());
  expect(harness.session.model?.id).toBe("faux-2");
  expect(harness.settingsManager.getDefaultModel()).toBe("faux-1");

  harness.session.setThinkingLevel("off");
  expect(harness.session.cycleThinkingLevel()).toBe("minimal");
  expect(harness.settingsManager.getDefaultThinkingLevel()).toBe("low");
});
const appliesPerModelThinkingLevelOverride = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [
        { id: "faux-1", name: "One", reasoning: true },
        { id: "faux-2", name: "Two", reasoning: true },
      ],
      settings: { defaultThinkingLevel: "medium" },
    }),
  );
  harnesses.push(harness);

  harness.settingsManager.setModelThinkingLevel("faux", "faux-2", "low");

  harness.session.setThinkingLevel("high");
  expect(harness.session.thinkingLevel).toBe("high");

  const model2 = harness.getModel("faux-2")!;
  yield* Effect.promise(() => harness.session.setModel(model2));
  expect(harness.session.thinkingLevel).toBe("low");

  const model1 = harness.getModel("faux-1")!;
  yield* Effect.promise(() => harness.session.setModel(model1));
  expect(harness.session.thinkingLevel).toBe("medium");
});
const fallsBackToCurrentSessionThinking = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [
        { id: "faux-1", name: "One", reasoning: true },
        { id: "faux-2", name: "Two", reasoning: true },
      ],
    }),
  );
  harnesses.push(harness);

  harness.session.setThinkingLevel("high");
  yield* Effect.promise(() => harness.session.setModel(harness.getModel("faux-2")!));
  expect(harness.session.thinkingLevel).toBe("high");
});
const perModelOverrideTakesPriorityOver = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [
        { id: "faux-1", name: "One", reasoning: true },
        { id: "faux-2", name: "Two", reasoning: true },
      ],
      settings: {
        defaultThinkingLevel: "high",
        modelThinkingLevels: { "faux/faux-2": "minimal" },
      },
    }),
  );
  harnesses.push(harness);

  const model2 = harness.getModel("faux-2")!;
  yield* Effect.promise(() => harness.session.setModel(model2));
  expect(harness.session.thinkingLevel).toBe("minimal");
});
const cyclesThroughScopedModelsAndPreserves = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [
        { id: "faux-1", name: "One", reasoning: true },
        { id: "faux-2", name: "Two", reasoning: false },
      ],
    }),
  );
  harnesses.push(harness);
  const modelOne = harness.getModel("faux-1")!;
  const modelTwo = harness.getModel("faux-2")!;
  harness.session.setScopedModels([
    { model: modelOne, thinkingLevel: "high" },
    { model: modelTwo },
  ] as Array<{
    model: aiTypes.Model<string>;
    thinkingLevel?: agentTypes.ThinkingLevel;
  }>);
  harness.session.setThinkingLevel("high");

  yield* Effect.promise(() => harness.session.cycleModel());
  expect(harness.session.model?.id).toBe("faux-2");
  expect(harness.session.thinkingLevel).toBe("off");

  yield* Effect.promise(() => harness.session.cycleModel());
  expect(harness.session.model?.id).toBe("faux-1");
  expect(harness.session.thinkingLevel).toBe("high");
});
const clampsThinkingLevelsToModelCapabilities = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({ models: [{ id: "faux-1", reasoning: false }] }),
  );
  harnesses.push(harness);

  harness.session.setThinkingLevel("high");
  expect(harness.session.thinkingLevel).toBe("off");
  expect(harness.session.cycleThinkingLevel()).toBeUndefined();
});
const cyclesXhighBeforeMaxWhenBoth = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({ models: [{ id: "faux-1", reasoning: true }] }),
  );
  harnesses.push(harness);
  harness.getModel().thinkingLevelMap = { max: "max", xhigh: "xhigh" };

  expect(harness.session.getAvailableThinkingLevels()).toEqual([
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);
  harness.session.setThinkingLevel("high");
  expect(harness.session.cycleThinkingLevel()).toBe("xhigh");
  expect(harness.session.cycleThinkingLevel()).toBe("max");
  expect(harness.session.cycleThinkingLevel()).toBe("off");
});
const throwsWhenSetmodelIsCalledWithout = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [
        { id: "faux-1", name: "One", reasoning: true },
        { id: "faux-2", name: "Two", reasoning: true },
      ],
      withConfiguredAuth: false,
    }),
  );
  harnesses.push(harness);

  yield* Effect.promise(() =>
    expect(harness.session.setModel(harness.getModel("faux-2")!)).rejects.toThrow(
      `No API key for ${harness.getModel().provider}/faux-2`,
    ),
  );
});

const agentSessionModelExtensionCases1 = {
  appliesPerModelThinkingLevelOverride,
  clampsThinkingLevelsToModelCapabilities,
  cyclemodelAndCyclethinkinglevelAreSessionOnly,
  cyclesThroughScopedModelsAndPreserves,
  cyclesXhighBeforeMaxWhenBoth,
  fallsBackToCurrentSessionThinking,
  harnesses,
  onlyPersistsModelAndThinkingDefaults,
  perModelOverrideTakesPriorityOver,
  persistsTheRequestedDefaultThinkingLevel,
  setmodelSavesTheModelToThe,
  throwsWhenSetmodelIsCalledWithout,
};

export default agentSessionModelExtensionCases1;
