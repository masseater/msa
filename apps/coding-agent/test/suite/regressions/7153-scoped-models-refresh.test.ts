import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import tui from "@msa/tui";
import { Effect } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type scopedModelsSelectorTypes from "../../../src/modes/interactive/components/scoped-models-selector.types.ts";
import interactiveModeFake from "../../interactive-mode-fake.ts";
import tuiKit from "../../tui-kit.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { bindModeFake } = interactiveModeFake;
const { setKeybindings } = tui;

const { KeybindingsManager, initTheme, stripAnsi } = tuiKit;

const { createHarness } = harnessModule;

const { deferredPromise } = testing;
type SelectorFactory = (close: () => void) => {
  component: scopedModelsSelectorTypes.ScopedModelsSelectorComponent;
  dispose?: () => void;
};

function stubModelRefresh(
  harness: harnessTypes.Harness,
  initialModels: readonly aiTypes.Model<aiTypes.Api>[],
) {
  let snapshot = initialModels;
  let finishRefresh: ((result: aiTypes.ModelsRefreshResult) => void) | undefined;
  let refreshSignal: AbortSignal | undefined;
  const runtime = harness.session.models.selection.modelRuntime;
  vi.spyOn(runtime, "getAvailableSnapshot").mockImplementation(() => snapshot);
  vi.spyOn(runtime, "refresh").mockImplementation((options) => {
    const refresh = deferredPromise<aiTypes.ModelsRefreshResult>();
    refreshSignal = options?.signal;
    finishRefresh = (value) => refresh.resolve(value);
    return refresh.promise;
  });
  return {
    complete(models: readonly aiTypes.Model<aiTypes.Api>[], result: aiTypes.ModelsRefreshResult) {
      snapshot = models;
      if (finishRefresh === undefined) throw new Error("Expected model refresh to start");
      finishRefresh(result);
    },
    get refreshSignal() {
      return refreshSignal;
    },
  };
}

function openSelector(
  harness: harnessTypes.Harness,
  initialModels: readonly aiTypes.Model<aiTypes.Api>[],
) {
  const refresh = stubModelRefresh(harness, initialModels);
  let selector: scopedModelsSelectorTypes.ScopedModelsSelectorComponent | undefined;
  let dispose: (() => void) | undefined;
  const done = vi.fn();
  const context = {
    editorSlot: {
      showSelector: (factory: SelectorFactory) => {
        const created = factory(() => {
          dispose?.();
          done();
        });
        selector = created.component;
        dispose = created.dispose;
      },
    },
    session: harness.session,
    settingsManager: harness.settingsManager,
    ui: { requestRender: vi.fn() },
    updateAvailableProviderCount: vi.fn(),
  };

  bindModeFake(context);
  bindModeFake(context).models.scoped.showModelsSelector();
  if (selector === undefined) throw new Error("Expected scoped-model selector to open");
  return {
    complete: refresh.complete,
    done,
    get refreshSignal() {
      return refresh.refreshSignal;
    },
    selector,
  };
}

let harness: harnessTypes.Harness | undefined;

const rendersCachedModelsImmediatelyAndUpdates = Effect.gen(function* () {
  harness = yield* Effect.promise(() =>
    createHarness({
      models: [
        { id: "cached", name: "Cached" },
        { id: "refreshed", name: "Refreshed" },
      ],
    }),
  );
  const refresh = openSelector(harness, [harness.models[0]]);

  const initial = stripAnsi(refresh.selector.render(100).join("\n"));
  expect(initial).toContain("cached");
  expect(initial).toContain("Refreshing model catalogs…");
  expect(initial).not.toContain("refreshed");

  refresh.complete(harness.models, { aborted: false, errors: new Map() });
  yield* Effect.promise(() =>
    vi.waitFor(() => {
      const rendered = stripAnsi(refresh.selector.render(100).join("\n"));
      expect(rendered).toContain("refreshed");
      expect(rendered).toContain("Model catalogs refreshed.");
    }),
  );
});

const cancelsTheBackgroundRefreshWhenThe = Effect.gen(function* () {
  harness = yield* Effect.promise(() =>
    createHarness({ models: [{ id: "cached", name: "Cached" }] }),
  );
  const refresh = openSelector(harness, harness.models);

  expect(refresh.refreshSignal).toBeDefined();
  refresh.selector.input.handleInput("\x1b");
  yield* Effect.promise(() => vi.waitFor(() => expect(refresh.refreshSignal?.aborted).toBe(true)));
  expect(refresh.done).toHaveBeenCalledOnce();
});

const rendersCachedModelsImmediatelyAndUpdatesAfter = () =>
  Effect.runPromise(rendersCachedModelsImmediatelyAndUpdates);

const cancelsTheBackgroundRefreshWhenTheSelector = () =>
  Effect.runPromise(cancelsTheBackgroundRefreshWhenThe);

describe("issue #7153 scoped models refresh", () => {
  beforeAll(() => initTheme("dark"));
  beforeEach(() => setKeybindings(new KeybindingsManager()));
  afterEach(() => Promise.resolve(harness?.cleanup()).finally(() => vi.restoreAllMocks()));
  it(
    "renders cached models immediately and updates after background refresh",
    rendersCachedModelsImmediatelyAndUpdatesAfter,
  );
  it(
    "cancels the background refresh when the selector closes",
    cancelsTheBackgroundRefreshWhenTheSelector,
  );
});
