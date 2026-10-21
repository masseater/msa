import testing from "@msa/testing";
import { Effect } from "effect";
import { beforeAll, describe, expect, test, vi } from "vite-plus/test";

import type extensionsTypesTypes from "../src/core/extensions/types.types.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import customUiScene from "./custom-ui-scene.ts";
import interactiveModeFake from "./interactive-mode-fake.ts";
import TestFocusableComponent from "./test-focusable-component.ts";

const { bindModeFake } = interactiveModeFake;

const { initTheme } = themeModule;
const { awaited, runTest } = testing;

const { createCustomUiScene } = customUiScene;

const openOverlayThenReplacement = Effect.fn("openOverlayThenReplacement")(function* (
  scene: ReturnType<typeof createCustomUiScene>,
) {
  const overlay = new TestFocusableComponent("OVERLAY");
  const replacement = new TestFocusableComponent("REPLACEMENT");
  const closers: { overlay?: (value: string) => void; replacement?: (value: string) => void } = {};
  const overlayPromise = scene.showExtensionCustom<string>(
    (_tui, _theme, _keybindings, done) => {
      closers.overlay = done;
      return overlay;
    },
    { overlay: true },
  );
  yield* scene.flush;
  expect(overlay.focused).toBe(true);
  const replacementPromise = scene.showExtensionCustom<string>(
    (_tui, _theme, _keybindings, done) => {
      closers.replacement = done;
      return replacement;
    },
  );
  yield* scene.flush;
  expect(replacement.focused).toBe(true);
  closers.replacement?.("done");
  yield* awaited(replacementPromise);
  return { closers, overlay, overlayPromise };
});

const overlayCustomUiReclaimsInputAfterNon = Effect.gen(function* () {
  const scene = createCustomUiScene();
  scene.ui.start();
  yield* Effect.gen(function* () {
    const { closers, overlay, overlayPromise } = yield* openOverlayThenReplacement(scene);
    yield* scene.flush;
    scene.terminal.sendInput("x");
    yield* scene.flush;
    expect(overlay.inputs).toEqual(["x"]);
    expect(scene.editor.inputs).toEqual([]);
    expect(overlay.focused).toBe(true);
    closers.overlay?.("closed");
    yield* awaited(overlayPromise);
  }).pipe(Effect.ensuring(Effect.sync(() => scene.ui.stop())));
});

describe("InteractiveMode.showExtensionCustom", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  test("overlay custom UI reclaims input after non-overlay custom UI closes", () =>
    runTest(overlayCustomUiReclaimsInputAfterNon));
});

const storesWrapperFactoriesAndRebuildsAutocompleteImmediately = () => {
  const wrapper: extensionsTypesTypes.AutocompleteProviderFactory = (current) => current;
  const fakeThis = {
    autocompleteProviderWrappers: [] as extensionsTypesTypes.AutocompleteProviderFactory[],
    setupAutocompleteProvider: vi.fn(),
  };

  const uiContext = bindModeFake(fakeThis).extensions.ui.createExtensionUIContext();
  uiContext.addAutocompleteProvider(wrapper);

  expect(fakeThis.autocompleteProviderWrappers).toEqual([wrapper]);
  expect(fakeThis.setupAutocompleteProvider).toHaveBeenCalledTimes(1);
};

describe("InteractiveMode.createExtensionUIContext addAutocompleteProvider", () => {
  test(
    "stores wrapper factories and rebuilds autocomplete immediately",
    storesWrapperFactoriesAndRebuildsAutocompleteImmediately,
  );
});
