import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { findEnvKeys, getEnvApiKey } from "../src/env-api-keys.ts";
import { envValue } from "./env.ts";

const originalAnthropicAuthToken = envValue("ANTHROPIC_AUTH_TOKEN");
const originalAnthropicOauthToken = envValue("ANTHROPIC_OAUTH_TOKEN");
const originalAnthropicApiKey = envValue("ANTHROPIC_API_KEY");

afterEach(() => {
  if (originalAnthropicAuthToken === undefined) {
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", undefined);
  } else {
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", originalAnthropicAuthToken);
  }

  if (originalAnthropicOauthToken === undefined) {
    vi.stubEnv("ANTHROPIC_OAUTH_TOKEN", undefined);
  } else {
    vi.stubEnv("ANTHROPIC_OAUTH_TOKEN", originalAnthropicOauthToken);
  }

  if (originalAnthropicApiKey === undefined) {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
  } else {
    vi.stubEnv("ANTHROPIC_API_KEY", originalAnthropicApiKey);
  }
});

describe("environment API keys", () => {
  it("reports ANTHROPIC_AUTH_TOKEN but preserves OAuth token API key lookup", () => {
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "auth-token");
    vi.stubEnv("ANTHROPIC_OAUTH_TOKEN", "oauth-token");
    vi.stubEnv("ANTHROPIC_API_KEY", "api-key");

    expect(findEnvKeys("anthropic")).toEqual([
      "ANTHROPIC_AUTH_TOKEN",
      "ANTHROPIC_OAUTH_TOKEN",
      "ANTHROPIC_API_KEY",
    ]);
    expect(getEnvApiKey("anthropic")).toBe("oauth-token");
  });

  it("does not return ANTHROPIC_AUTH_TOKEN as an API key", () => {
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "auth-token");
    vi.stubEnv("ANTHROPIC_OAUTH_TOKEN", undefined);
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);

    expect(findEnvKeys("anthropic")).toEqual(["ANTHROPIC_AUTH_TOKEN"]);
    expect(getEnvApiKey("anthropic")).toBeUndefined();
  });

  it("preserves ANTHROPIC_OAUTH_TOKEN as an API key", () => {
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", undefined);
    vi.stubEnv("ANTHROPIC_OAUTH_TOKEN", "oauth-token");
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);

    expect(findEnvKeys("anthropic")).toEqual(["ANTHROPIC_OAUTH_TOKEN"]);
    expect(getEnvApiKey("anthropic")).toBe("oauth-token");
  });

  it("falls back to ANTHROPIC_API_KEY for API key lookup", () => {
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", undefined);
    vi.stubEnv("ANTHROPIC_OAUTH_TOKEN", undefined);
    vi.stubEnv("ANTHROPIC_API_KEY", "api-key");

    expect(getEnvApiKey("anthropic")).toBe("api-key");
  });
});
