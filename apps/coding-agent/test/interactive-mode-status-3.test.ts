import testing from "@msa/testing";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";
import { describe, expect, test, vi } from "vite-plus/test";

import type extensionsTypesTypes from "../src/core/extensions/types.types.ts";
import interactiveModeFake from "./interactive-mode-fake.ts";

const { bindModeFake } = interactiveModeFake;

const { CombinedAutocompleteProvider } = tui;

const { awaited, runTest } = testing;

const stacksWrapperFactoriesOverAFreshBasePart1 = () => {
  const defaultEditor = { setAutocompleteProvider: vi.fn() };
  const customEditor = { setAutocompleteProvider: vi.fn() };
  const calls: string[] = [];

  const wrap1: extensionsTypesTypes.AutocompleteProviderFactory = (
    current,
  ): tuiTypes.AutocompleteProvider => ({
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      calls.push("applyCompletion:wrap1");
      return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    },
    getSuggestions(lines, cursorLine, cursorCol, options) {
      return runTest(
        Effect.gen(function* () {
          calls.push("getSuggestions:wrap1");
          return yield* awaited(current.getSuggestions(lines, cursorLine, cursorCol, options));
        }),
      );
    },
    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      calls.push("shouldTrigger:wrap1");
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
  });
  return { calls, customEditor, defaultEditor, wrap1 };
};

const stacksWrapperFactoriesOverAFreshBase = () => {
  const { calls, customEditor, defaultEditor, wrap1 } = stacksWrapperFactoriesOverAFreshBasePart1();
  const wrap2: extensionsTypesTypes.AutocompleteProviderFactory = (
    current,
  ): tuiTypes.AutocompleteProvider => ({
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      calls.push("applyCompletion:wrap2");
      return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    },
    getSuggestions(lines, cursorLine, cursorCol, options) {
      return runTest(
        Effect.gen(function* () {
          calls.push("getSuggestions:wrap2");
          return yield* awaited(current.getSuggestions(lines, cursorLine, cursorCol, options));
        }),
      );
    },
    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      calls.push("shouldTrigger:wrap2");
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
  });

  const fakeThis = {
    autocompleteProviderWrappers: [wrap1, wrap2],
    createBaseAutocompleteProvider: () =>
      new CombinedAutocompleteProvider([], "/tmp/project", undefined),
    defaultEditor,
    editor: customEditor,
  };

  bindModeFake(fakeThis).input.autocomplete.setupAutocompleteProvider();

  expect(defaultEditor.setAutocompleteProvider).toHaveBeenCalledTimes(1);
  expect(customEditor.setAutocompleteProvider).toHaveBeenCalledTimes(1);
  const provider = defaultEditor.setAutocompleteProvider.mock
    .calls[0]?.[0] as tuiTypes.AutocompleteProvider;
  expect(provider).toBe(customEditor.setAutocompleteProvider.mock.calls[0]?.[0]);
  expect(provider.shouldTriggerFileCompletion?.(["foo"], 0, 3)).toBe(true);
  expect(calls).toEqual(["shouldTrigger:wrap2", "shouldTrigger:wrap1"]);
};

const mergesTriggercharactersFromWrapperFactories = () => {
  const defaultEditor = { setAutocompleteProvider: vi.fn() };
  const customEditor = { setAutocompleteProvider: vi.fn() };
  const passThrough =
    (triggerCharacters: string[]): extensionsTypesTypes.AutocompleteProviderFactory =>
    (current) => ({
      applyCompletion: (lines, cursorLine, cursorCol, item, prefix) =>
        current.applyCompletion(lines, cursorLine, cursorCol, item, prefix),
      getSuggestions: (lines, cursorLine, cursorCol, options) =>
        current.getSuggestions(lines, cursorLine, cursorCol, options),
      triggerCharacters,
    });

  const fakeThis = {
    autocompleteProviderWrappers: [passThrough(["$"]), passThrough(["!"])],
    createBaseAutocompleteProvider: () =>
      new CombinedAutocompleteProvider([], "/tmp/project", undefined),
    defaultEditor,
    editor: customEditor,
  };

  bindModeFake(fakeThis).input.autocomplete.setupAutocompleteProvider();

  const provider = defaultEditor.setAutocompleteProvider.mock
    .calls[0]?.[0] as tuiTypes.AutocompleteProvider;
  expect(provider.triggerCharacters).toEqual(["$", "!"]);
};

describe("InteractiveMode.setupAutocompleteProvider", () => {
  test("stacks wrapper factories over a fresh base provider", stacksWrapperFactoriesOverAFreshBase);

  test(
    "merges triggerCharacters from wrapper factories",
    mergesTriggercharactersFromWrapperFactories,
  );
});
