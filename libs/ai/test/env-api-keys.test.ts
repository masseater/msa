import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { findEnvKeys, getEnvApiKey } from "../src/env-api-keys.ts";
import { envValue } from "./env.ts";

const originalAnthropicAuthToken = envValue("ANTHROPIC_AUTH_TOKEN");
const originalAnthropicApiKey = envValue("ANTHROPIC_API_KEY");

afterEach(() => {
  if (originalAnthropicAuthToken === undefined) {
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", undefined);
  } else {
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", originalAnthropicAuthToken);
  }

  if (originalAnthropicApiKey === undefined) {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
  } else {
    vi.stubEnv("ANTHROPIC_API_KEY", originalAnthropicApiKey);
  }
});

describe("environment API keys", () => {
  it("reports ANTHROPIC_AUTH_TOKEN but returns ANTHROPIC_API_KEY as the API key", () => {
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "auth-token");
    vi.stubEnv("ANTHROPIC_API_KEY", "api-key");

    expect(findEnvKeys("anthropic-api")).toEqual(["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"]);
    expect(getEnvApiKey("anthropic-api")).toBe("api-key");
  });

  it("does not return ANTHROPIC_AUTH_TOKEN as an API key", () => {
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "auth-token");
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);

    expect(findEnvKeys("anthropic-api")).toEqual(["ANTHROPIC_AUTH_TOKEN"]);
    expect(getEnvApiKey("anthropic-api")).toBeUndefined();
  });

  it("falls back to ANTHROPIC_API_KEY for API key lookup", () => {
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", undefined);
    vi.stubEnv("ANTHROPIC_API_KEY", "api-key");

    expect(getEnvApiKey("anthropic-api")).toBe("api-key");
  });
});
