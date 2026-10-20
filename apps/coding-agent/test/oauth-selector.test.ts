import testing from "@msa/testing";
import tui from "@msa/tui";
import { beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import KeybindingsManager from "../src/core/keybindings-manager.ts";
import OAuthSelectorComponent from "../src/modes/interactive/components/oauth-selector.ts";
import LoginFlow from "../src/modes/interactive/login-flow.ts";
import type loginFlowTypes from "../src/modes/interactive/login-flow.types.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import ansi from "../src/utils/ansi.ts";
const { stripAnsi } = ansi;
const { initTheme } = themeModule;
const { setKeybindings } = tui;

const { awaited, runTest } = testing;

const projectsProviderOwnedAuthOptionsWithoutProvider = () => {
  const providers = [
    {
      auth: {
        apiKey: { login: () => runTest(awaited({})), name: "Anthropic API key" },
        oauth: { login: () => runTest(awaited({})), name: "Anthropic (Claude Pro/Max)" },
      },
      id: "anthropic",
      name: "Anthropic",
    },
    {
      auth: { apiKey: { name: "OpenCode API key" } },
      id: "opencode",
      name: "OpenCode Zen",
    },
  ];
  const loginFlow = new LoginFlow({
    session: {
      modelRuntime: {
        getProviderAuthStatus: () => ({ configured: false }),
        getProviders: () => providers,
        isUsingOAuth: () => false,
      },
    },
  } as unknown as loginFlowTypes.LoginFlowHost);

  const apiKeyOptions = loginFlow.getProviderOptions("api_key");
  expect(apiKeyOptions).toMatchObject([
    {
      authType: "api_key",
      id: "anthropic",
      method: { name: "Anthropic API key" },
      name: "Anthropic",
    },
    {
      authType: "api_key",
      id: "opencode",
      method: { name: "OpenCode API key" },
      name: "OpenCode Zen",
    },
  ]);
  expect(loginFlow.getProviderOptions("oauth")).toMatchObject([
    { authType: "oauth", id: "anthropic", name: "Anthropic" },
  ]);
};

const rendersAnOptionWithoutCompiledAuthStatus = () => {
  const selector = new OAuthSelectorComponent(
    "login",
    [{ authType: "api_key", id: "opencode", name: "OpenCode Zen" }],
    () => {},
    () => {},
  );

  const output = stripAnsi(selector.render(120).join("\n"));
  expect(output).toContain("not configured");
  expect(output).not.toContain("✓ configured");
};

const showsOauthAuthDistinctlyInTheApi = () => {
  const selector = new OAuthSelectorComponent(
    "login",
    [
      {
        authType: "api_key",
        id: "anthropic",
        name: "Anthropic",
        status: { source: "OAuth", type: "oauth" },
      },
    ],
    () => {},
    () => {},
  );

  const output = stripAnsi(selector.render(120).join("\n"));
  expect(output).toContain("subscription configured");
};

const showsEnvironmentApiKeyAuthAsConfigured = () => {
  const selector = new OAuthSelectorComponent(
    "login",
    [
      {
        authType: "api_key",
        id: "openai",
        name: "OpenAI",
        status: { source: "OPENAI_API_KEY", type: "api_key" },
      },
    ],
    () => {},
    () => {},
  );

  const output = stripAnsi(selector.render(120).join("\n"));
  expect(output).toContain("✓ env: OPENAI_API_KEY");
  expect(output).not.toContain("not configured");
};

const showsModelsJsonApiKeyAuthAs = () => {
  const selector = new OAuthSelectorComponent(
    "login",
    [
      {
        authType: "api_key",
        id: "local-proxy",
        name: "local-proxy",
        status: { source: "key in models.json", type: "api_key" },
      },
    ],
    () => {},
    () => {},
  );

  expect(stripAnsi(selector.render(120).join("\n"))).toContain("✓ key in models.json");
};

const showsModelsJsonCommandAuthAsConfigured = () => {
  const selector = new OAuthSelectorComponent(
    "login",
    [
      {
        authType: "api_key",
        id: "op-proxy",
        name: "op-proxy",
        status: { source: "command in models.json", type: "api_key" },
      },
    ],
    () => {},
    () => {},
  );

  expect(stripAnsi(selector.render(120).join("\n"))).toContain("✓ command in models.json");
};

describe("OAuthSelectorComponent", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  beforeEach(() => {
    setKeybindings(new KeybindingsManager());
  });

  it(
    "projects provider-owned auth options without provider-specific filtering",
    projectsProviderOwnedAuthOptionsWithoutProvider,
  );

  it(
    "renders an option without compiled auth status as not configured",
    rendersAnOptionWithoutCompiledAuthStatus,
  );

  it("shows OAuth auth distinctly in the API key selector", showsOauthAuthDistinctlyInTheApi);

  it("shows environment API key auth as configured", showsEnvironmentApiKeyAuthAsConfigured);

  it("shows models.json API key auth as configured", showsModelsJsonApiKeyAuthAs);

  it("shows models.json command auth as configured", showsModelsJsonCommandAuthAsConfigured);
});
