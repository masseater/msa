import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type modelTypesModule from "../../../../../libs/ai/src/model-types.ts";
import components from "../../../src/modes/interactive/components/index.ts";
import type modelSelectorTypes from "../../../src/modes/interactive/components/model-selector.types.ts";
import tuiKit from "../../tui-kit.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { ModelSelectorComponent, ScopedModelsSelectorComponent } = components;

const { setKeybindings } = tui;

const { KeybindingsManager, initTheme, stripAnsi } = tuiKit;

const { createHarness } = harnessModule;

function createFakeTui(): tuiTypes.TUI {
  return {
    requestRender: () => {},
  } as unknown as tuiTypes.TUI;
}

const harnesses: harnessTypes.Harness[] = [];

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
      onCancel: () => {},
      onChange: (enabledModelIds) => {
        changes.push(enabledModelIds);
      },
      onPersist: () => {},
    },
  );

  selector.input.handleInput("\x1b[1;3B");

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
    harness.session.models.selection.modelRuntime,
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
  return yield* preservesScopedModelOrderInTheStep1(modelOne, modelTwo, modelThree, selector);
});

const preservesScopedModelOrderInTheStep1 = (
  modelOne: modelTypesModule.Model<string>,
  modelTwo: modelTypesModule.Model<string>,
  modelThree: modelTypesModule.Model<string>,
  selector: modelSelectorTypes.ModelSelectorComponent,
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

const propagatesReorderedScopedModelsBackToThe = () =>
  Effect.runPromise(propagatesReorderedScopedModelsBackTo);

const preservesScopedModelOrderInTheModel = () => Effect.runPromise(preservesScopedModelOrderInThe);

const afterEachHook = () => {
  while (harnesses.length > 0) {
    harnesses.pop()?.cleanup();
  }
};

describe("issue #3217 scoped model ordering", () => {
  beforeAll(() => {
    initTheme("dark");
  });
  beforeEach(() => {
    setKeybindings(new KeybindingsManager());
  });
  afterEach(afterEachHook);
  it(
    "propagates reordered scoped models back to the session state",
    propagatesReorderedScopedModelsBackToThe,
  );
  it("preserves scoped model order in the /model scoped tab", preservesScopedModelOrderInTheModel);
});
