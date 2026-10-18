import { afterEach, describe, expect, it } from "vite-plus/test";

import { findEnvKeys, getEnvApiKey } from "../src/env-api-keys.ts";

const originalAnthropicAuthToken = process.env["ANTHROPIC_AUTH_TOKEN"];
const originalAnthropicApiKey = process.env["ANTHROPIC_API_KEY"];

afterEach(() => {
  if (originalAnthropicAuthToken === undefined) {
    delete process.env["ANTHROPIC_AUTH_TOKEN"];
  } else {
    process.env["ANTHROPIC_AUTH_TOKEN"] = originalAnthropicAuthToken;
  }

  if (originalAnthropicApiKey === undefined) {
    delete process.env["ANTHROPIC_API_KEY"];
  } else {
    process.env["ANTHROPIC_API_KEY"] = originalAnthropicApiKey;
  }
});

describe("environment API keys", () => {
  it("reports ANTHROPIC_AUTH_TOKEN but returns ANTHROPIC_API_KEY as the API key", () => {
    process.env["ANTHROPIC_AUTH_TOKEN"] = "auth-token";
    process.env["ANTHROPIC_API_KEY"] = "api-key";

    expect(findEnvKeys("anthropic-api")).toEqual(["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"]);
    expect(getEnvApiKey("anthropic-api")).toBe("api-key");
  });

  it("does not return ANTHROPIC_AUTH_TOKEN as an API key", () => {
    process.env["ANTHROPIC_AUTH_TOKEN"] = "auth-token";
    delete process.env["ANTHROPIC_API_KEY"];

    expect(findEnvKeys("anthropic-api")).toEqual(["ANTHROPIC_AUTH_TOKEN"]);
    expect(getEnvApiKey("anthropic-api")).toBeUndefined();
  });

  it("falls back to ANTHROPIC_API_KEY for API key lookup", () => {
    delete process.env["ANTHROPIC_AUTH_TOKEN"];
    process.env["ANTHROPIC_API_KEY"] = "api-key";

    expect(getEnvApiKey("anthropic-api")).toBe("api-key");
  });
});
