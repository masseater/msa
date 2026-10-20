import testing from "@msa/testing";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import type oauthSelectorTypes from "../src/modes/interactive/components/oauth-selector.types.ts";
import InteractiveMode from "../src/modes/interactive/interactive-mode.ts";
import interactiveModeFake from "./interactive-mode-fake.ts";

const { bindModeFake } = interactiveModeFake;

const { abortController, awaited, runTest } = testing;

type TestModel = { id: string; provider: string; name: string };

type FakeInteractiveMode = {
  session: {
    extensions: { binding: { extensionRunner: { getRegisteredCommands: () => [] } } };
    models: {
      selection: {
        modelRuntime: { getAvailableSnapshot: () => TestModel[] };
        scopedModels: Array<{ model: TestModel }>;
      };
    };
    promptTemplates: [];
    resourceLoader: { getSkills: () => { skills: [] } };
    tools: { externalServices: { getExternalServices: () => [] } };
  };
  settingsManager: { resources: { getEnableSkillCommands: () => boolean } };
  skillCommands: Map<string, string>;
  sessionManager: { getCwd: () => string };
  fdPath: null;
};

const matchesModelCommandArgumentsAcrossProviderModel = Effect.gen(function* () {
  const models = [
    { id: "openai/gpt-5.2-codex", name: "GPT-5.2 Codex", provider: "openrouter" },
    { id: "gpt-5.5", name: "GPT-5.5", provider: "openai-codex" },
  ];
  const fakeThis: FakeInteractiveMode = {
    fdPath: null,
    session: {
      extensions: { binding: { extensionRunner: { getRegisteredCommands: () => [] } } },
      models: {
        selection: { modelRuntime: { getAvailableSnapshot: () => models }, scopedModels: [] },
      },
      promptTemplates: [],
      resourceLoader: { getSkills: () => ({ skills: [] }) },
      tools: { externalServices: { getExternalServices: () => [] } },
    },
    sessionManager: { getCwd: () => "/tmp" },
    settingsManager: { resources: { getEnableSkillCommands: () => false } },
    skillCommands: new Map(),
  };

  bindModeFake(fakeThis);
  const provider = bindModeFake(fakeThis).input.autocomplete.createBaseAutocompleteProvider();
  const line = "/model codexgpt";
  const suggestions = yield* awaited(
    provider.getSuggestions([line], 0, line.length, {
      signal: abortController().signal,
    }),
  );

  expect(suggestions?.items.map((item) => item.value)).toEqual([
    "openai-codex/gpt-5.5",
    "openrouter/openai/gpt-5.2-codex",
  ]);
});

const matchesLoginCommandArgumentsByProviderIdStep = () => {
  type LoginCommandMode = {
    session: {
      extensions: { binding: { extensionRunner: { getRegisteredCommands: () => [] } } };
      models: { selection: { modelRuntime: { getAvailableSnapshot: () => [] }; scopedModels: [] } };
      promptTemplates: [];
      resourceLoader: { getSkills: () => { skills: [] } };
      tools: { externalServices: { getExternalServices: () => [] } };
    };
    settingsManager: { resources: { getEnableSkillCommands: () => boolean } };
    skillCommands: Map<string, string>;
    sessionManager: { getCwd: () => string };
    fdPath: null;
    loginFlow: { getProviderOptions: () => oauthSelectorTypes.AuthSelectorProvider[] };
  };
  const createBaseAutocompleteProvider = (
    InteractiveMode as unknown as {
      prototype: {
        createBaseAutocompleteProvider(this: LoginCommandMode): tuiTypes.AutocompleteProvider;
      };
    }
  ).prototype.createBaseAutocompleteProvider;
  const fakeThis: LoginCommandMode = {
    fdPath: null,
    loginFlow: {
      getProviderOptions: () => [
        { authType: "oauth", id: "anthropic", name: "Anthropic", subscription: true },
        { authType: "api_key", id: "anthropic", name: "Anthropic", subscription: true },
        { authType: "api_key", id: "openai", name: "OpenAI" },
        { authType: "oauth", id: "openrouter", name: "OpenRouter", subscription: false },
      ],
    },
    session: {
      extensions: { binding: { extensionRunner: { getRegisteredCommands: () => [] } } },
      models: { selection: { modelRuntime: { getAvailableSnapshot: () => [] }, scopedModels: [] } },
      promptTemplates: [],
      resourceLoader: { getSkills: () => ({ skills: [] }) },
      tools: { externalServices: { getExternalServices: () => [] } },
    },
    sessionManager: { getCwd: () => "/tmp" },
    settingsManager: { resources: { getEnableSkillCommands: () => false } },
    skillCommands: new Map(),
  };
  return { createBaseAutocompleteProvider, fakeThis };
};

const matchesLoginCommandArgumentsByProviderId = Effect.gen(function* () {
  const { fakeThis } = matchesLoginCommandArgumentsByProviderIdStep();

  bindModeFake(fakeThis);
  const provider = bindModeFake(fakeThis).input.autocomplete.createBaseAutocompleteProvider();
  const line = "/login subscription anthrop";
  const suggestions = yield* awaited(
    provider.getSuggestions([line], 0, line.length, {
      signal: abortController().signal,
    }),
  );

  expect(suggestions?.items).toEqual([
    {
      description: "Anthropic · subscription/API key",
      label: "anthropic",
      value: "anthropic",
    },
  ]);

  const openRouterLine = "/login openrouter";
  const openRouterSuggestions = yield* awaited(
    provider.getSuggestions([openRouterLine], 0, openRouterLine.length, {
      signal: abortController().signal,
    }),
  );
  expect(openRouterSuggestions?.items).toEqual([
    { description: "OpenRouter · account", label: "openrouter", value: "openrouter" },
  ]);
});

describe("InteractiveMode.createBaseAutocompleteProvider", () => {
  test("matches model command arguments across provider/model order", () =>
    runTest(matchesModelCommandArgumentsAcrossProviderModel));

  test("matches login command arguments by provider id and name", () =>
    runTest(matchesLoginCommandArgumentsByProviderId));
});
