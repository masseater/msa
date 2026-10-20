import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type scopedModelsSelectorTypes from "../../../src/modes/interactive/components/scoped-models-selector.types.ts";
import InteractiveMode from "../../../src/modes/interactive/interactive-mode.ts";
import tuiKit from "../../tui-kit.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";
const { setKeybindings } = tui;

const { KeybindingsManager, initTheme, stripAnsi } = tuiKit;

const { createHarness } = harnessModule;

const { deferredPromise } = testing;

const showModelsSelector = Reflect.get(InteractiveMode.prototype, "showModelsSelector") as (
  this: object,
) => void;

type SelectorFactory = (close: () => void) => {
  component: scopedModelsSelectorTypes.ScopedModelsSelectorComponent;
  dispose?: () => void;
};

function openSelector(
  harness: harnessTypes.Harness,
  initialModels: readonly aiTypes.Model<aiTypes.Api>[],
) {
  let snapshot = initialModels;
  let finishRefresh: ((result: aiTypes.ModelsRefreshResult) => void) | undefined;
  let refreshSignal: AbortSignal | undefined;
  let selector: scopedModelsSelectorTypes.ScopedModelsSelectorComponent | undefined;
  let dispose: (() => void) | undefined;
  const done = vi.fn();
  vi.spyOn(
    harness.session.models.selection.modelRuntime,
    "getAvailableSnapshot",
  ).mockImplementation(() => snapshot);
  vi.spyOn(harness.session.models.selection.modelRuntime, "refresh").mockImplementation(
    (options) => {
      const refresh = deferredPromise<aiTypes.ModelsRefreshResult>();
      refreshSignal = options?.signal;
      finishRefresh = (value) => refresh.resolve(value);
      return refresh.promise;
    },
  );
  const context = {
    editorSlot: {
      showSelector: (factory: SelectorFactory) => {
        const close = () => {
          dispose?.();
          done();
        };
        const created = factory(close);
        selector = created.component;
        dispose = created.dispose;
      },
    },
    session: harness.session,
    settingsManager: harness.settingsManager,
    ui: { requestRender: vi.fn() } as unknown as tuiTypes.TUI,
    updateAvailableProviderCount: vi.fn(),
  };

  Object.setPrototypeOf(context, InteractiveMode.prototype);
  showModelsSelector.call(context);
  if (selector === undefined) throw new Error("Expected scoped-model selector to open");
  return {
    complete(models: readonly aiTypes.Model<aiTypes.Api>[], result: aiTypes.ModelsRefreshResult) {
      snapshot = models;
      if (finishRefresh === undefined) throw new Error("Expected model refresh to start");
      finishRefresh(result);
    },
    done,
    get refreshSignal() {
      return refreshSignal;
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
  refresh.selector.handleInput("\x1b");
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
  afterEach(() => {
    harness?.cleanup();
    vi.restoreAllMocks();
  });
  it(
    "renders cached models immediately and updates after background refresh",
    rendersCachedModelsImmediatelyAndUpdatesAfter,
  );
  it(
    "cancels the background refresh when the selector closes",
    cancelsTheBackgroundRefreshWhenTheSelector,
  );
});
