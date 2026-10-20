import type aiTypes from "@msa/ai/index.types";
import tui from "@msa/tui";
import { Effect } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ScopedModelsSelectorComponent } from "../../../src/modes/interactive/components/scoped-models-selector.ts";
import { InteractiveMode } from "../../../src/modes/interactive/interactive-mode.ts";
import tuiKit from "../../tui-kit.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { setKeybindings } = tui;

const { KeybindingsManager, initTheme, stripAnsi, theme } = tuiKit;

const { createHarness } = harnessModule;

function createInteractiveContext(options: {
  allModels: aiTypes.Model<aiTypes.Api>[];
  enabledModelIds: string[];
  scopedModels?: Array<{ model: aiTypes.Model<aiTypes.Api> }>;
}) {
  let selector: ScopedModelsSelectorComponent | undefined;
  const setScopedModels = vi.fn();
  const getAvailableSnapshot = vi.fn(() => options.allModels);
  const context = {
    editorSlot: {
      showSelector: (
        factory: (done: () => void) => { component: ScopedModelsSelectorComponent },
      ) => {
        selector = factory(() => {}).component;
      },
    },
    session: {
      modelRuntime: {
        getAvailableSnapshot,
        refresh: vi.fn().mockResolvedValue({ aborted: false, errors: new Map() }),
      },
      scopedModels: options.scopedModels ?? [],
      setScopedModels,
    },
    settingsManager: {
      getEnabledModels: () => options.enabledModelIds,
      setEnabledModels: vi.fn(),
    },
    showStatus: vi.fn(),
    ui: { requestRender: vi.fn() },
    updateAvailableProviderCount: vi.fn(),
  };
  return { context, getAvailableSnapshot, getSelector: () => selector, setScopedModels };
}

function showModelsSelector(context: object): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const show = Reflect.get(InteractiveMode.prototype, "showModelsSelector") as (
        this: object,
      ) => Promise<void>;
      yield* Effect.promise(() => Promise.resolve(show.call(context)));
    }),
  );
}

const harnesses: harnessTypes.Harness[] = [];

const showsAndRemovesAnEnabledModel = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({ models: [{ id: "available", name: "Available" }] }),
  );
  harnesses.push(harness);
  const availableId = `${harness.models[0].provider}/${harness.models[0].id}`;
  const unavailableId = `${harness.models[0].provider}/unavailable`;
  const changes: Array<string[] | null> = [];
  const persisted: Array<string[] | null> = [];
  const selector = new ScopedModelsSelectorComponent(
    {
      allModels: [...harness.models],
      enabledModelIds: [unavailableId, availableId],
    },
    {
      onCancel: () => {},
      onChange: (enabledIds) => {
        changes.push(enabledIds);
      },
      onPersist: (enabledIds) => {
        persisted.push(enabledIds);
      },
    },
  );

  const rendered = selector.render(100).join("\n");
  expect(stripAnsi(rendered)).toContain(`${unavailableId} [unavailable]`);
  expect(rendered).toContain(theme.strikethrough(unavailableId));
  selector.handleInput("\r");
  expect(changes).toEqual([[availableId]]);
  selector.handleInput("\x13");
  expect(persisted).toEqual([[availableId]]);
});

const passesUnmatchedSettingsPatternsToThe = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({ models: [{ id: "available", name: "Available" }] }),
  );
  harnesses.push(harness);
  const unavailableIds = ["unavailable-one", "unavailable-two"].map(
    (id) => `${harness.models[0].provider}/${id}`,
  );
  const { context, getAvailableSnapshot, getSelector } = createInteractiveContext({
    allModels: [],
    enabledModelIds: unavailableIds,
  });

  yield* Effect.promise(() => showModelsSelector(context));

  const selector = getSelector();
  if (selector === undefined) throw new Error("Expected scoped-model selector to open");
  const rendered = stripAnsi(selector.render(100).join("\n"));
  for (const unavailableId of unavailableIds) {
    expect(rendered).toContain(`${unavailableId} [unavailable]`);
  }
  expect(getAvailableSnapshot).toHaveBeenCalled();
});

const opensWhenOnlyASessionScoped = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({ models: [{ id: "unavailable", name: "Unavailable" }] }),
  );
  harnesses.push(harness);
  const model = harness.models[0];
  const fullId = `${model.provider}/${model.id}`;
  const { context, getSelector } = createInteractiveContext({
    allModels: [],
    enabledModelIds: [],
    scopedModels: [{ model }],
  });

  yield* Effect.promise(() => showModelsSelector(context));

  const selector = getSelector();
  if (selector === undefined) throw new Error("Expected scoped-model selector to open");
  expect(stripAnsi(selector.render(100).join("\n"))).toContain(`${fullId} [unavailable]`);
});

const doesNotClearAPartialScope = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [
        { id: "one", name: "One" },
        { id: "two", name: "Two" },
        { id: "three", name: "Three" },
      ],
    }),
  );
  harnesses.push(harness);
  const [one, two] = harness.models;
  if (one === undefined || two === undefined) throw new Error("expected two harness models");
  const enabledIds = [one, two].map((model) => `${model.provider}/${model.id}`);
  const unavailableId = `${one.provider}/unavailable`;
  const { context, getSelector, setScopedModels } = createInteractiveContext({
    allModels: [...harness.models],
    enabledModelIds: [...enabledIds, unavailableId],
    scopedModels: [{ model: one }, { model: two }],
  });

  yield* Effect.promise(() => showModelsSelector(context));
  const selector = getSelector();
  if (selector === undefined) throw new Error("Expected scoped-model selector to open");
  selector.handleInput("\x1b[1;3B");

  yield* Effect.promise(() =>
    vi.waitFor(() => {
      expect(setScopedModels).toHaveBeenLastCalledWith([
        { model: two, thinkingLevel: undefined },
        { model: one, thinkingLevel: undefined },
      ]);
    }),
  );
});

const showsAndRemovesAnEnabledModelWithout = () => Effect.runPromise(showsAndRemovesAnEnabledModel);

const passesUnmatchedSettingsPatternsToTheSelector = () =>
  Effect.runPromise(passesUnmatchedSettingsPatternsToThe);

const opensWhenOnlyASessionScopedModel = () => Effect.runPromise(opensWhenOnlyASessionScoped);

const doesNotClearAPartialScopeWhen = () => Effect.runPromise(doesNotClearAPartialScope);

describe("issue #6949 unavailable scoped models", () => {
  beforeAll(() => {
    initTheme("dark");
  });
  beforeEach(() => {
    setKeybindings(new KeybindingsManager());
  });
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });
  it(
    "shows and removes an enabled model without a catalog entry",
    showsAndRemovesAnEnabledModelWithout,
  );
  it(
    "passes unmatched settings patterns to the selector with one combined resolution",
    passesUnmatchedSettingsPatternsToTheSelector,
  );
  it("opens when only a session-scoped model is unavailable", opensWhenOnlyASessionScopedModel);
  it(
    "does not clear a partial scope when an enabled model is unavailable",
    doesNotClearAPartialScopeWhen,
  );
});
