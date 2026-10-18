import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { InMemoryCredentialStore } from "../src/auth/credential-store.ts";
import { openaiChatGPTOAuth } from "../src/auth/oauth/openai-chatgpt.ts";
import { openaiCodexOAuth } from "../src/auth/oauth/openai-codex.ts";
import { openRouterOAuth } from "../src/auth/oauth/openrouter.ts";
import { createModels } from "../src/models.ts";
import * as extensionOAuthCompatibility from "../src/oauth.ts";
import { openaiProvider } from "../src/providers/openai.ts";

const neverAbortedSignal = new AbortController().signal;

describe("OAuthAuth adapters", () => {
  it("keeps the extension OAuth barrel free of built-in flow implementations", () => {
    expect(extensionOAuthCompatibility).not.toHaveProperty("openaiCodexOAuth");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("identifies only subscription-backed OAuth flows as subscriptions", () => {
    for (const oauth of [openaiChatGPTOAuth, openaiCodexOAuth]) {
      expect(oauth.isSubscription).toBe(true);
    }
    expect(openRouterOAuth.isSubscription).not.toBe(true);
  });

  it("OpenAI exposes ChatGPT OAuth alongside API-key auth", () => {
    const provider = openaiProvider();
    expect(provider.auth.apiKey).toBeDefined();
    expect(provider.auth.oauth).toMatchObject({
      name: "OpenAI (ChatGPT subscription)",
      isSubscription: true,
      loginLabel: "Sign in with ChatGPT",
    });
  });

  it("openai-codex toAuth derives the api key from the access token", async () => {
    const auth = await openaiCodexOAuth.toAuth({
      type: "oauth",
      access: "token",
      refresh: "r",
      expires: 0,
    });
    expect(auth).toEqual({ apiKey: "token" });
  });

  it("openrouter derives the api key and keeps the permanent credential on refresh", async () => {
    const credential = {
      type: "oauth" as const,
      access: "token",
      refresh: "",
      expires: Number.MAX_SAFE_INTEGER,
    };
    expect(await openRouterOAuth.toAuth(credential)).toEqual({ apiKey: "token" });
    expect(await openRouterOAuth.refresh(credential, neverAbortedSignal)).toBe(credential);
  });
});

describe("OAuth through Models.getAuth (lazy load chain)", () => {
  it("resolves stored ChatGPT oauth credentials via the lazy flow import", async () => {
    const credentials = new InMemoryCredentialStore();
    await credentials.modify("openai", () =>
      Promise.resolve({
        type: "oauth",
        access: "oauth-access-token",
        refresh: "r",
        // Keep this beyond getAuth()'s refresh window.
        expires: Date.now() + 10 * 60_000,
      }),
    );
    const models = createModels({ credentials });
    models.setProvider(openaiProvider());

    const model = models.getModels("openai")[0];

    if (!model) throw new Error("Expected a model");
    const result = await models.getAuth(model.provider);
    expect(result?.auth.apiKey).toBe("oauth-access-token");
    expect(result?.source).toBe("OAuth");
  });
});
