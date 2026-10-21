import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import sdkOpenrouterAttributionSupport from "./sdk-openrouter-attribution-support.ts";

const { captureHeaders, cleanupDirs, createModel, prepareDirs } = sdkOpenrouterAttributionSupport;

const { awaited, runTest } = testing;

const preservesLegacyOpenrouterBaseUrlSubstringAttribution = Effect.gen(function* () {
  const headers = yield* awaited(
    captureHeaders(createModel("custom-openrouter", "not-a-url-openrouter.ai")),
  );

  expect(headers?.["HTTP-Referer"]).toBe("https://github.com/masseater/msa");
  expect(headers?.["X-OpenRouter-Title"]).toBe("msa");
  expect(headers?.["X-OpenRouter-Categories"]).toBe("cli-agent");
});

const letsProviderAndRequestHeadersOverrideThe = Effect.gen(function* () {
  const headers = yield* awaited(
    captureHeaders(createModel("openrouter", "https://openrouter.ai/api/v1"), {
      providerHeaders: {
        "HTTP-Referer": "https://provider.example",
        "X-OpenRouter-Categories": "provider-category",
      },
      requestHeaders: {
        "X-OpenRouter-Title": "request-title",
      },
    }),
  );

  expect(headers?.["HTTP-Referer"]).toBe("https://provider.example");
  expect(headers?.["X-OpenRouter-Title"]).toBe("request-title");
  expect(headers?.["X-OpenRouter-Categories"]).toBe("provider-category");
});

const addsOpencodeSessionHeaders = Effect.gen(function* () {
  const headers = yield* awaited(
    captureHeaders(createModel("opencode", "https://opencode.ai/zen/v1"), {
      sessionId: "opencode-session",
    }),
  );

  expect(headers?.["x-opencode-session"]).toBe("opencode-session");
  expect(headers?.["x-opencode-client"]).toBe("msa");
});

const letsConfiguredOpencodeHeadersOverrideTheDefaults = Effect.gen(function* () {
  const headers = yield* awaited(
    captureHeaders(createModel("opencode", "https://opencode.ai/zen/v1"), {
      providerHeaders: {
        "x-opencode-client": "configured-client",
        "x-opencode-session": "configured-session",
      },
      sessionId: "opencode-session",
    }),
  );

  expect(headers?.["x-opencode-session"]).toBe("configured-session");
  expect(headers?.["x-opencode-client"]).toBe("configured-client");
});

describe("createAgentSession provider attribution headers", () => {
  beforeEach(() => runTest(prepareDirs));

  afterEach(() => {
    vi.stubEnv("MSA_TELEMETRY", undefined);
    return runTest(cleanupDirs);
  });

  it("preserves legacy OpenRouter base URL substring attribution matching", () =>
    runTest(preservesLegacyOpenrouterBaseUrlSubstringAttribution));

  it("lets provider and request headers override the defaults", () =>
    runTest(letsProviderAndRequestHeadersOverrideThe));

  it("adds OpenCode session headers", () => runTest(addsOpencodeSessionHeaders));

  it("lets configured OpenCode headers override the defaults", () =>
    runTest(letsConfiguredOpencodeHeadersOverrideTheDefaults));
});
