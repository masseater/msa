import { awaited, runTest } from "@msa/testing";
import { setKeybindings } from "@msa/tui";
import { Effect } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { KeybindingsManager } from "../src/core/keybindings.ts";
import { ScopedModelsSelectorComponent } from "../src/modes/interactive/components/scoped-models-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

interface ModelState {
  id: string;
  name: string;
  enabled: boolean;
}

function getMarkerStates(selector: ScopedModelsSelectorComponent, models: ModelState[]): boolean[] {
  const lines = stripAnsi(selector.render(120).join("\n")).split("\n");
  return models.map((model) => {
    const line = lines.find((candidate) => candidate.includes(`${model.id} [`));
    if (line === undefined) throw new Error(`Expected rendered row for ${model.id}`);
    return line.slice(2).startsWith("✓ ");
  });
}

describe("scoped models selector", () => {
  let harness: Harness | undefined;

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
            onChange: (enabledModelIds) => {
              for (const model of models) {
                model.enabled =
                  enabledModelIds === null || enabledModelIds.includes(`${provider}/${model.id}`);
              }
            },
            onPersist: () => {},
            onCancel: () => {},
          },
        );
        return yield* awaited(selector);
      }),
    );
  }

  it("marks every model after enabling all", () =>
    runTest(
      Effect.gen(function* () {
        const models = [
          { id: "model-a", name: "Model A", enabled: true },
          { id: "model-b", name: "Model B", enabled: false },
          { id: "model-c", name: "Model C", enabled: false },
        ];
        const selector = yield* awaited(createSelector(models));

        selector.handleInput("\x01");

        expect(models.map((model) => model.enabled)).toEqual([true, true, true]);
        expect(getMarkerStates(selector, models)).toEqual([true, true, true]);
        expect(stripAnsi(selector.render(120).join("\n"))).toContain("all enabled");
      }),
    ));

  it("disables only the selected model after enabling all", () =>
    runTest(
      Effect.gen(function* () {
        const models = [
          { id: "model-a", name: "Model A", enabled: true },
          { id: "model-b", name: "Model B", enabled: false },
          { id: "model-c", name: "Model C", enabled: false },
        ];
        const selector = yield* awaited(createSelector(models));

        selector.handleInput("\x01");
        selector.handleInput("\r");

        expect(models.map((model) => model.enabled)).toEqual([false, true, true]);
        expect(getMarkerStates(selector, models)).toEqual([false, true, true]);
      }),
    ));

  it("enables only the selected model after clearing all", () =>
    runTest(
      Effect.gen(function* () {
        const models = [
          { id: "model-a", name: "Model A", enabled: true },
          { id: "model-b", name: "Model B", enabled: true },
          { id: "model-c", name: "Model C", enabled: true },
        ];
        const selector = yield* awaited(createSelector(models));

        selector.handleInput("\x18");
        expect(models.map((model) => model.enabled)).toEqual([false, false, false]);
        expect(getMarkerStates(selector, models)).toEqual([false, false, false]);

        selector.handleInput("\r");
        expect(models.map((model) => model.enabled)).toEqual([true, false, false]);
        expect(getMarkerStates(selector, models)).toEqual([true, false, false]);
      }),
    ));

  it("restores the all-enabled state after re-enabling the last disabled model", () =>
    runTest(
      Effect.gen(function* () {
        const models = [
          { id: "model-a", name: "Model A", enabled: true },
          { id: "model-b", name: "Model B", enabled: false },
          { id: "model-c", name: "Model C", enabled: false },
        ];
        const selector = yield* awaited(createSelector(models));

        selector.handleInput("\x01");
        selector.handleInput("\r");
        selector.handleInput("\x1b[B");
        selector.handleInput("\x1b[B");
        selector.handleInput("\r");

        expect(models.map((model) => model.enabled)).toEqual([true, true, true]);
        expect(getMarkerStates(selector, models)).toEqual([true, true, true]);
        expect(stripAnsi(selector.render(120).join("\n"))).toContain("all enabled");
      }),
    ));
});
