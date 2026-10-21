import testing from "@msa/testing";
import tui from "@msa/tui";
import { Effect } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import components from "../src/modes/interactive/components/index.ts";
import type scopedModelsSelectorTypes from "../src/modes/interactive/components/scoped-models-selector.types.ts";
import harnessModule from "./suite/harness.ts";
import type harnessTypes from "./suite/harness.types.ts";
import tuiKit from "./tui-kit.ts";

const { ScopedModelsSelectorComponent } = components;

const { KeybindingsManager, initTheme, stripAnsi } = tuiKit;
const { setKeybindings } = tui;

const { createHarness } = harnessModule;

const { awaited, runTest } = testing;

interface ModelState {
  id: string;
  name: string;
  enabled: boolean;
}

function getMarkerStates(
  selector: scopedModelsSelectorTypes.ScopedModelsSelectorComponent,
  models: ModelState[],
): boolean[] {
  const lines = stripAnsi(selector.render(120).join("\n")).split("\n");
  return models.map((model) => {
    const line = lines.find((candidate) => candidate.includes(`${model.id} [`));
    if (line === undefined) throw new Error(`Expected rendered row for ${model.id}`);
    return line.slice(2).startsWith("✓ ");
  });
}

let harness: harnessTypes.Harness | undefined;

function createSelector(models: ModelState[]) {
  return runTest(
    Effect.gen(function* () {
      harness = yield* awaited(createHarness({ models }));
      const provider = harness.models[0].provider;
      const selector = new ScopedModelsSelectorComponent(
        {
          allModels: [...harness.models],
          enabledModelIds: models
            .filter((model) => model.enabled)
            .map((model) => `${provider}/${model.id}`),
        },
        {
          onCancel: () => {},
          onChange: (enabledModelIds) => {
            for (const model of models) {
              model.enabled =
                enabledModelIds === null || enabledModelIds.includes(`${provider}/${model.id}`);
            }
          },
          onPersist: () => {},
        },
      );
      return yield* awaited(selector);
    }),
  );
}

const marksEveryModelAfterEnablingAll = () =>
  runTest(
    Effect.gen(function* () {
      const models = [
        { enabled: true, id: "model-a", name: "Model A" },
        { enabled: false, id: "model-b", name: "Model B" },
        { enabled: false, id: "model-c", name: "Model C" },
      ];
      const selector = yield* awaited(createSelector(models));

      selector.input.handleInput("\x01");

      expect(models.map((model) => model.enabled)).toEqual([true, true, true]);
      expect(getMarkerStates(selector, models)).toEqual([true, true, true]);
      expect(stripAnsi(selector.render(120).join("\n"))).toContain("all enabled");
    }),
  );

const disablesOnlyTheSelectedModelAfterEnabling = () =>
  runTest(
    Effect.gen(function* () {
      const models = [
        { enabled: true, id: "model-a", name: "Model A" },
        { enabled: false, id: "model-b", name: "Model B" },
        { enabled: false, id: "model-c", name: "Model C" },
      ];
      const selector = yield* awaited(createSelector(models));

      selector.input.handleInput("\x01");
      selector.input.handleInput("\r");

      expect(models.map((model) => model.enabled)).toEqual([false, true, true]);
      expect(getMarkerStates(selector, models)).toEqual([false, true, true]);
    }),
  );

const enablesOnlyTheSelectedModelAfterClearing = () =>
  runTest(
    Effect.gen(function* () {
      const models = [
        { enabled: true, id: "model-a", name: "Model A" },
        { enabled: true, id: "model-b", name: "Model B" },
        { enabled: true, id: "model-c", name: "Model C" },
      ];
      const selector = yield* awaited(createSelector(models));

      selector.input.handleInput("\x18");
      expect(models.map((model) => model.enabled)).toEqual([false, false, false]);
      expect(getMarkerStates(selector, models)).toEqual([false, false, false]);

      selector.input.handleInput("\r");
      expect(models.map((model) => model.enabled)).toEqual([true, false, false]);
      expect(getMarkerStates(selector, models)).toEqual([true, false, false]);
    }),
  );

const restoresTheAllEnabledStateAfterRe = () =>
  runTest(
    Effect.gen(function* () {
      const models = [
        { enabled: true, id: "model-a", name: "Model A" },
        { enabled: false, id: "model-b", name: "Model B" },
        { enabled: false, id: "model-c", name: "Model C" },
      ];
      const selector = yield* awaited(createSelector(models));

      selector.input.handleInput("\x01");
      selector.input.handleInput("\r");
      selector.input.handleInput("\x1b[B");
      selector.input.handleInput("\x1b[B");
      selector.input.handleInput("\r");

      expect(models.map((model) => model.enabled)).toEqual([true, true, true]);
      expect(getMarkerStates(selector, models)).toEqual([true, true, true]);
      expect(stripAnsi(selector.render(120).join("\n"))).toContain("all enabled");
    }),
  );

describe("scoped models selector", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  beforeEach(() => {
    setKeybindings(new KeybindingsManager());
  });

  afterEach(() => {
    harness?.cleanup();
    harness = undefined;
  });

  it("marks every model after enabling all", marksEveryModelAfterEnablingAll);

  it(
    "disables only the selected model after enabling all",
    disablesOnlyTheSelectedModelAfterEnabling,
  );

  it(
    "enables only the selected model after clearing all",
    enablesOnlyTheSelectedModelAfterClearing,
  );

  it(
    "restores the all-enabled state after re-enabling the last disabled model",
    restoresTheAllEnabledStateAfterRe,
  );
});
