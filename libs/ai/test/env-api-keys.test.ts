import { afterEach, describe, expect, it } from "vitest";

import { findEnvKeys, getEnvApiKey } from "../src/env-api-keys.ts";

const originalZaiCodingCnApiKey = process.env.ZAI_CODING_CN_API_KEY;
const originalAnthropicAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
const originalAnthropicOauthToken = process.env.ANTHROPIC_OAUTH_TOKEN;
const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  if (originalZaiCodingCnApiKey === undefined) {
    delete process.env.ZAI_CODING_CN_API_KEY;
  } else {
    process.env.ZAI_CODING_CN_API_KEY = originalZaiCodingCnApiKey;
  }

  if (originalAnthropicAuthToken === undefined) {
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  } else {
    process.env.ANTHROPIC_AUTH_TOKEN = originalAnthropicAuthToken;
  }

  if (originalAnthropicOauthToken === undefined) {
    delete process.env.ANTHROPIC_OAUTH_TOKEN;
  } else {
    process.env.ANTHROPIC_OAUTH_TOKEN = originalAnthropicOauthToken;
  }

  if (originalAnthropicApiKey === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = originalAnthropicApiKey;
  }
});

describe("environment API keys", () => {
  it("resolves ZAI China Coding Plan credentials from ZAI_CODING_CN_API_KEY", () => {
    process.env.ZAI_CODING_CN_API_KEY = "zai-coding-cn-token";

    expect(findEnvKeys("zai-coding-cn")).toEqual(["ZAI_CODING_CN_API_KEY"]);
    expect(getEnvApiKey("zai-coding-cn")).toBe("zai-coding-cn-token");
  });

  it("reports ANTHROPIC_AUTH_TOKEN but preserves OAuth token API key lookup", () => {
    process.env.ANTHROPIC_AUTH_TOKEN = "auth-token";
    process.env.ANTHROPIC_OAUTH_TOKEN = "oauth-token";
    process.env.ANTHROPIC_API_KEY = "api-key";

    expect(findEnvKeys("anthropic")).toEqual([
      "ANTHROPIC_AUTH_TOKEN",
      "ANTHROPIC_OAUTH_TOKEN",
      "ANTHROPIC_API_KEY",
    ]);
    expect(getEnvApiKey("anthropic")).toBe("oauth-token");
  });

  it("does not return ANTHROPIC_AUTH_TOKEN as an API key", () => {
    process.env.ANTHROPIC_AUTH_TOKEN = "auth-token";
    delete process.env.ANTHROPIC_OAUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;

    expect(findEnvKeys("anthropic")).toEqual(["ANTHROPIC_AUTH_TOKEN"]);
    expect(getEnvApiKey("anthropic")).toBeUndefined();
  });

  it("preserves ANTHROPIC_OAUTH_TOKEN as an API key", () => {
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    process.env.ANTHROPIC_OAUTH_TOKEN = "oauth-token";
    delete process.env.ANTHROPIC_API_KEY;

    expect(findEnvKeys("anthropic")).toEqual(["ANTHROPIC_OAUTH_TOKEN"]);
    expect(getEnvApiKey("anthropic")).toBe("oauth-token");
  });

  it("falls back to ANTHROPIC_API_KEY for API key lookup", () => {
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_OAUTH_TOKEN;
    process.env.ANTHROPIC_API_KEY = "api-key";

    expect(getEnvApiKey("anthropic")).toBe("api-key");
  });
});
