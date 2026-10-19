import { setKeybindings, type TUI } from "@msa/tui";
import { Effect } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { Model } from "../../../../../libs/ai/src/model-types.ts";
import { KeybindingsManager } from "../../../src/core/keybindings.ts";
import { ModelSelectorComponent } from "../../../src/modes/interactive/components/model-selector.ts";
import { ScopedModelsSelectorComponent } from "../../../src/modes/interactive/components/scoped-models-selector.ts";
import { initTheme } from "../../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../../src/utils/ansi.ts";
import { createHarness, type Harness } from "../harness.ts";

function createFakeTui(): TUI {
  return {
    requestRender: () => {},
  } as unknown as TUI;
}

const harnesses: Harness[] = [];

const propagatesReorderedScopedModelsBackTo = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [
        { id: "faux-1", name: "One", reasoning: true },
        { id: "faux-2", name: "Two", reasoning: true },
        { id: "faux-3", name: "Three", reasoning: true },
      ],
    }),
  );
  harnesses.push(harness);

  const orderedIds = harness.models.map((model) => `${model.provider}/${model.id}`);
  const changes: Array<string[] | null> = [];
  const selector = new ScopedModelsSelectorComponent(
    {
      allModels: [...harness.models],
      enabledModelIds: orderedIds,
    },
    {
      onChange: (enabledModelIds) => {
        changes.push(enabledModelIds);
      },
      onPersist: () => {},
      onCancel: () => {},
    },
  );

  selector.handleInput("\x1b[1;3B");

  expect(changes).toEqual([[orderedIds[1], orderedIds[0], orderedIds[2]]]);
});

const preservesScopedModelOrderInThe = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [
        { id: "faux-1", name: "One", reasoning: true },
        { id: "faux-2", name: "Two", reasoning: true },
        { id: "faux-3", name: "Three", reasoning: true },
      ],
    }),
  );
  harnesses.push(harness);
  const modelOne = harness.getModel("faux-1")!;
  const modelTwo = harness.getModel("faux-2")!;
  const modelThree = harness.getModel("faux-3")!;
  const selector = new ModelSelectorComponent(
    createFakeTui(),
    modelOne,
    harness.session.modelRuntime,
    [{ model: modelTwo }, { model: modelOne }, { model: modelThree }],
    () => {},
    () => {},
  );
  yield* Effect.promise(() =>
    vi.waitFor(() => {
      const rendered = stripAnsi(selector.render(120).join("\n"));
      expect(rendered).toContain(`[${modelOne.provider}]`);
      expect(rendered).toContain("Model catalogs refreshed.");
    }),
  );
  return yield* preservesScopedModelOrderInThePart2(modelOne, modelTwo, modelThree, selector);
});

const preservesScopedModelOrderInThePart2 = (
  modelOne: Model<string>,
  modelTwo: Model<string>,
  modelThree: Model<string>,
  selector: ModelSelectorComponent,
) =>
  Effect.sync(() => {
    const renderedLines = stripAnsi(selector.render(120).join("\n"))
      .split("\n")
      .filter((line) => line.includes(`[${modelOne.provider}]`));
    const orderedIds = renderedLines.slice(0, 3).map((line) => {
      const [modelId] = line
        .trim()
        .replace(/^→\s*/u, "")
        .split(" [");
      return modelId?.replace(/^✓\s*/u, "").trim() ?? "";
    });
    expect(orderedIds).toEqual([modelTwo.id, modelOne.id, modelThree.id]);
  });

describe("issue #3217 scoped model ordering", () => {
  beforeAll(() => {
    initTheme("dark");
  });
  beforeEach(() => {
    setKeybindings(new KeybindingsManager());
  });
  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });
  it("propagates reordered scoped models back to the session state", () =>
    Effect.runPromise(propagatesReorderedScopedModelsBackTo));
  it("preserves scoped model order in the /model scoped tab", () =>
    Effect.runPromise(preservesScopedModelOrderInThe));
});
